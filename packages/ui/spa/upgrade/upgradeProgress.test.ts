import type {
  ProposalJson,
  ProposalUpgrade,
} from "../proposals/proposalsClient";
import type { PublishProposalState } from "../components/proposals/PublishProposalDialog";
import {
  upgradeFooterOf,
  upgradeProgressOf,
  type UpgradeRenderState,
} from "./upgradeProgress";

const IDLE: UpgradeRenderState = { status: "idle" };

/*
 * Where an upgrade proposal is (valbuild/home `docs/adept.md`, decision 20):
 * Publish only once the typecheck of what it stages found no new errors and
 * it is built.
 */
const NAME = "0123456789abcdef0123";
const upgrade = (over: Partial<ProposalUpgrade> = {}): ProposalUpgrade => ({
  path: "latest",
  state: "staged",
  changes: [{ name: "zod", from: "3.0.0", to: "3.1.0", kind: "minor" }],
  vulnerableBefore: null,
  vulnerableAfter: null,
  error: null,
  ...over,
});
const proposal = (over: Partial<ProposalJson> = {}): ProposalJson => ({
  name: NAME,
  branch: `val/p/${NAME}`,
  displayName: "Upgrade dependencies",
  status: "open",
  updatedAt: "2026-10-21T10:00:00.000Z",
  staged: { files: ["package.json"], inputs: "i1", buildRequired: false },
  dependencies: { state: "own" },
  ...over,
});

describe("an upgrade's progress", () => {
  test("computing: nothing after it has started", () => {
    const view = upgradeProgressOf({
      render: IDLE,
      proposal: proposal({ staged: undefined, dependencies: undefined }),
      upgrade: upgrade({ state: "computing", changes: [] }),
      typecheck: { status: "idle" },
      code: null,
    });
    expect(view.dependencies.state).toBe("waiting");
    expect(view.typecheck.state).toBe("waiting");
    expect(view.build.state).toBe("waiting");
    expect(view.canPublish).toBe(false);
  });

  test("a lockfile that does not match waits on Compute lockfile, and nothing is typechecked against it", () => {
    const view = upgradeProgressOf({
      render: IDLE,
      proposal: proposal({
        dependencies: { state: "lockfile", computing: false, error: "stale" },
      }),
      upgrade: upgrade(),
      typecheck: { status: "idle" },
      code: { state: "lockfile", computing: false, error: "stale" },
    });
    expect(view.dependencies).toEqual({ state: "lockfile", detail: "stale" });
    expect(view.typecheck.state).toBe("waiting");
    expect(view.canPublish).toBe(false);
  });

  test("a typecheck of other inputs is not this one's: it runs again", () => {
    const view = upgradeProgressOf({
      render: IDLE,
      proposal: proposal({
        typecheck: {
          inputs: "older",
          newErrors: 0,
          errors: [],
          checkedAt: "x",
        },
      }),
      upgrade: upgrade(),
      typecheck: { status: "idle" },
      code: null,
    });
    expect(view.typecheck.state).toBe("running");
    expect(view.canPublish).toBe(false);
  });

  test("new type errors keep it from being published, and say how many", () => {
    const view = upgradeProgressOf({
      render: IDLE,
      proposal: proposal({
        typecheck: {
          inputs: "i1",
          newErrors: 3,
          errors: [
            { file: "src/a.ts", line: 1, column: 1, code: 2322, message: "x" },
          ],
          checkedAt: "x",
        },
      }),
      upgrade: upgrade(),
      typecheck: { status: "idle" },
      code: null,
    });
    expect(view.typecheck).toMatchObject({ state: "done", newErrors: 3 });
    expect(view.canPublish).toBe(false);
  });

  test("no new errors, but not built: Build first", () => {
    const view = upgradeProgressOf({
      render: IDLE,
      proposal: proposal({
        staged: { files: ["package.json"], inputs: "i1", buildRequired: true },
        typecheck: { inputs: "i1", newErrors: 0, errors: [], checkedAt: "x" },
      }),
      upgrade: upgrade(),
      typecheck: { status: "idle" },
      code: { state: "required" },
    });
    expect(view.build.state).toBe("required");
    expect(view.canPublish).toBe(false);
  });

  const checkedAndBuilt = (render: UpgradeRenderState) =>
    upgradeProgressOf({
      render,
      proposal: proposal({
        typecheck: { inputs: "i1", newErrors: 0, errors: [], checkedAt: "x" },
        built: { hash: "h1", inputs: "i1" },
      }),
      upgrade: upgrade(),
      typecheck: { status: "idle" },
      code: null,
    });
  const READY: PublishProposalState = {
    kind: "ready",
    checks: [],
    changes: 1,
    unsaved: 0,
  };

  test("no new errors and built: the build is rendered on the platform, and Publish waits for it", () => {
    for (const render of [
      IDLE,
      { status: "running", key: "h1:i1" },
      // A render of another build is not this one's.
      { status: "passed", key: "h0:i0" },
    ] satisfies UpgradeRenderState[]) {
      const view = checkedAndBuilt(render);
      expect(view.render.state).toBe("running");
      expect(view.canPublish).toBe(false);
      expect(upgradeFooterOf(view, READY)).toEqual({
        note: "Publish waits for the new build to render.",
        action: { kind: "publish", enabled: false, busy: false },
      });
    }
  });

  test("no new errors, built, and it renders: Publish", () => {
    const view = checkedAndBuilt({ status: "passed", key: "h1:i1" });
    expect(view.canPublish).toBe(true);
    expect(upgradeFooterOf(view, READY)).toEqual({
      note: "Built, no new type errors, and it renders.",
      action: { kind: "publish", enabled: true, busy: false },
    });
  });

  test("a build that does not render cannot be published, and is not offered again", () => {
    const view = checkedAndBuilt({
      status: "failed",
      key: "h1:i1",
      message: "/ answered 500",
      retryable: false,
    });
    expect(view.render).toMatchObject({
      state: "failed",
      detail: "/ answered 500",
    });
    expect(view.canPublish).toBe(false);
    expect(upgradeFooterOf(view, READY).action).toEqual({ kind: "close" });
  });

  test("a render the platform could not do is tried again from the footer", () => {
    const view = checkedAndBuilt({
      status: "failed",
      key: "h1:i1",
      message: "The loader did not answer.",
      retryable: true,
    });
    expect(upgradeFooterOf(view, READY).action).toEqual({
      kind: "retry",
      step: "render",
    });
  });

  test("a content service that cannot render one leaves it to the publish", () => {
    const view = checkedAndBuilt({ status: "unsupported", key: "h1:i1" });
    expect(view.render).toMatchObject({ state: "done", deferred: true });
    expect(view.canPublish).toBe(true);
  });

  test("nothing is rendered before it is typechecked and built", () => {
    const view = upgradeProgressOf({
      render: IDLE,
      proposal: proposal({
        staged: { files: ["package.json"], inputs: "i1", buildRequired: true },
        typecheck: { inputs: "i1", newErrors: 0, errors: [], checkedAt: "x" },
      }),
      upgrade: upgrade(),
      typecheck: { status: "idle" },
      code: { state: "building" },
    });
    expect(view.render.state).toBe("waiting");
  });

  test("this tab's typecheck says where it is, and why it stopped", () => {
    const running = upgradeProgressOf({
      render: IDLE,
      proposal: proposal(),
      upgrade: upgrade(),
      typecheck: {
        status: "running",
        name: NAME,
        step: { step: "checking", which: "proposal", detail: "Loading types" },
      },
      code: null,
    });
    expect(running.typecheck).toMatchObject({
      state: "running",
      detail: "The upgrade: Loading types",
    });
    const failed = upgradeProgressOf({
      render: IDLE,
      proposal: proposal(),
      upgrade: upgrade(),
      typecheck: {
        status: "failed",
        name: NAME,
        message: "adept could not be reached",
        retryable: true,
      },
      code: null,
    });
    expect(failed.typecheck).toMatchObject({
      state: "failed",
      detail: "adept could not be reached",
      retryable: true,
    });
  });

  test("a build running says which step and how far, from the build's own progress", () => {
    const view = upgradeProgressOf({
      render: IDLE,
      proposal: proposal({
        staged: { files: ["package.json"], inputs: "i1", buildRequired: true },
      }),
      upgrade: upgrade(),
      typecheck: { status: "idle" },
      code: { state: "building" },
      buildProgress: { label: "Uploading 41 of 112", percent: 46 },
    });
    expect(view.build).toEqual({
      state: "running",
      detail: "Uploading 41 of 112",
      percent: 46,
    });
    expect(view.canPublish).toBe(false);
  });

  test("a build waiting on a builder tab the browser would not open asks for a tap", () => {
    const view = upgradeProgressOf({
      render: IDLE,
      proposal: proposal({
        staged: { files: ["package.json"], inputs: "i1", buildRequired: true },
      }),
      upgrade: upgrade(),
      typecheck: { status: "idle" },
      code: { state: "blocked" },
    });
    expect(view.build.state).toBe("tap");
  });
});
