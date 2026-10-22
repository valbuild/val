import type {
  ProposalJson,
  ProposalUpgrade,
} from "../proposals/proposalsClient";
import { upgradeProgressOf } from "./upgradeProgress";

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

  test("no new errors, built, its dependencies its own: Publish", () => {
    const view = upgradeProgressOf({
      proposal: proposal({
        typecheck: { inputs: "i1", newErrors: 0, errors: [], checkedAt: "x" },
      }),
      upgrade: upgrade(),
      typecheck: { status: "idle" },
      code: null,
    });
    expect(view.canPublish).toBe(true);
  });

  test("this tab's typecheck says where it is, and why it stopped", () => {
    const running = upgradeProgressOf({
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
