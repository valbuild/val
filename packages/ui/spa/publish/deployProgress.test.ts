import {
  deployPercent,
  describeDeploy,
  describeDeployPhase,
  DEPLOY_STEPS,
} from "./deployProgress";

describe("the publish line", () => {
  test("says how far it has got, as a percentage", () => {
    expect(
      describeDeploy({
        status: "running",
        phase: { kind: "building" },
        startedAt: 0,
        phaseStartedAt: 0,
        commit: "c",
      }),
    ).toBe("Publishing 12%");
  });

  test("is gone once it is live — the deploy summary says Live", () => {
    expect(
      describeDeploy({
        status: "done",
        result: { status: "live", url: null, visible: true },
        ms: 29_000,
        steps: [],
        commit: "c",
      }),
    ).toBeNull();
  });

  test("and once it failed — the failure has its own message", () => {
    expect(
      describeDeploy({
        status: "done",
        result: { status: "failed", message: "no", problems: [] },
        ms: 1,
        steps: [],
        commit: "c",
      }),
    ).toBeNull();
  });
});

describe("the percentage", () => {
  test("only ever goes up, step by step", () => {
    const percents = DEPLOY_STEPS.map((kind) =>
      deployPercent(
        kind === "uploading" ? { kind, done: 0, total: 4 } : { kind },
      ),
    );
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
  });

  test("moves through the upload, file by file", () => {
    const at = (done: number) =>
      deployPercent({ kind: "uploading", done, total: 4 });
    expect(at(0)).toBeLessThan(at(2));
    expect(at(2)).toBeLessThan(at(4));
    expect(at(4)).toBeLessThanOrEqual(deployPercent({ kind: "confirming" }));
  });

  test("never says 100 — done is the line going away", () => {
    expect(deployPercent({ kind: "propagating" })).toBeLessThan(100);
  });

  test("the tab still names each step", () => {
    expect(describeDeployPhase({ kind: "propagating" })).toMatch(/waiting/);
  });
});
