import { describeDeploy, describeDeployPhase } from "./deployProgress";

describe("the publish line", () => {
  test("names the step and how long the publish has run", () => {
    expect(
      describeDeploy(
        {
          status: "running",
          phase: { kind: "uploading", done: 2, total: 7 },
          startedAt: 1_000,
          phaseStartedAt: 5_000,
        },
        13_400,
      ),
    ).toBe("Uploading 2 of 7 · 12s");
  });

  test("says when it is live but not yet served here", () => {
    expect(describeDeployPhase({ kind: "propagating" })).toMatch(/waiting/);
    expect(
      describeDeploy(
        {
          status: "done",
          result: { status: "live", url: null, visible: false },
          ms: 61_000,
          steps: [],
        },
        0,
      ),
    ).toMatch(/Live after 61s — this location may take/);
  });

  test("says plainly when it is live and served", () => {
    expect(
      describeDeploy(
        {
          status: "done",
          result: { status: "live", url: null, visible: true },
          ms: 42_400,
          steps: [],
        },
        0,
      ),
    ).toBe("Live after 42s");
  });

  test("leaves a failure to its own message", () => {
    expect(
      describeDeploy(
        {
          status: "done",
          result: { status: "failed", message: "no", problems: [] },
          ms: 1,
          steps: [],
        },
        0,
      ),
    ).toBeNull();
  });
});
