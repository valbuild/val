import type { ShellDeployment } from "../components/shell/types";
import {
  EDGE_CACHE_MS,
  RUNNING_JOB_STALE_MS,
  describeIndicator,
  explainIndicator,
  indicatorPercent,
  isInFlight,
  publishIndicator,
  type ObservedJob,
} from "./publishIndicator";
import type { StudioDeployState } from "./useStudioDeploy";

const idle: StudioDeployState = { status: "idle" };

const building: StudioDeployState = {
  status: "running",
  phase: { kind: "building" },
  startedAt: 0,
  phaseStartedAt: 0,
  commit: null,
};

const liveAt = (finishedAt: number): StudioDeployState => ({
  status: "done",
  result: { status: "live", url: null },
  ms: 30_000,
  steps: [],
  commit: "C1",
  finishedAt,
});

const failedAt = (finishedAt: number): StudioDeployState => ({
  status: "done",
  result: { status: "failed", message: "nope", problems: [] },
  ms: 30_000,
  steps: [],
  commit: null,
  finishedAt,
});

const row = (over: Partial<ShellDeployment> = {}): ShellDeployment => ({
  commitSha: "C1",
  state: "success",
  message: "Update the title",
  timestamp: "just now",
  updatedAt: new Date(0).toISOString(),
  isLive: true,
  ...over,
});

const job = (over: Partial<ObservedJob>): ObservedJob => ({
  id: "J1",
  status: "running",
  seenAt: 0,
  ...over,
});

describe("this editor's publish", () => {
  test("while it builds here: the step and how far", () => {
    const indicator = publishIndicator({ own: building, now: 1 });
    expect(indicator).toEqual({
      kind: "publishing",
      mine: true,
      step: "Building",
      percent: 12,
    });
    expect(describeIndicator(indicator, 1)).toBe("Publishing 12%");
    expect(explainIndicator(indicator, 1)).toBe("Building");
  });

  test("while a builder tab builds it: that tab's step and percentage", () => {
    expect(
      publishIndicator({
        own: building,
        builder: { step: "Uploading 3 of 7", percent: 52 },
        now: 1,
      }),
    ).toEqual({
      kind: "publishing",
      mine: true,
      step: "Uploading 3 of 7",
      percent: 52,
    });
  });

  test("Live is not the end: it spins until every edge has it", () => {
    const own = liveAt(10_000);
    const indicator = publishIndicator({ own, now: 10_000 + 20_000 });
    expect(indicator).toEqual({
      kind: "reaching",
      mine: true,
      everywhereAt: 10_000 + EDGE_CACHE_MS,
    });
    expect(isInFlight(indicator)).toBe(true);
    expect(explainIndicator(indicator, 30_000)).toBe(
      "Live. Every visitor sees your changes within 40s.",
    );
  });

  test("the bar keeps filling while the edges catch up, and never reaches 100", () => {
    const indicator = publishIndicator({ own: liveAt(0), now: 0 });
    expect(indicatorPercent(indicator, 0)).toBe(88);
    expect(indicatorPercent(indicator, EDGE_CACHE_MS / 2)).toBe(94);
    expect(indicatorPercent(indicator, EDGE_CACHE_MS - 1)).toBe(99);
    expect(describeIndicator(indicator, EDGE_CACHE_MS / 2)).toBe(
      "Reaching visitors 94%",
    );
  });

  test("and stops once the edges' cache has run out", () => {
    const indicator = publishIndicator({
      own: liveAt(10_000),
      deployments: [row()],
      now: 10_000 + EDGE_CACHE_MS,
    });
    expect(indicator).toEqual({ kind: "live" });
    expect(isInFlight(indicator)).toBe(false);
  });

  test("a failure stays until something newer goes live", () => {
    expect(
      publishIndicator({
        own: failedAt(5_000),
        deployments: [row()],
        now: 6_000,
      }),
    ).toEqual({ kind: "failed" });
  });
});

describe("another editor's publish", () => {
  test("a running job on the branch spins here too", () => {
    expect(
      publishIndicator({
        own: idle,
        jobs: [job({ seenAt: 1_000 })],
        now: 2_000,
      }),
    ).toEqual({ kind: "publishing", mine: false, step: null, percent: null });
  });

  test("a job silent for too long is not believed", () => {
    expect(
      publishIndicator({
        own: idle,
        jobs: [job({ seenAt: 0 })],
        deployments: [row({ updatedAt: new Date(-1e9).toISOString() })],
        studioIsDeployer: true,
        now: RUNNING_JOB_STALE_MS,
      }),
    ).toEqual({ kind: "live" });
  });

  test("managed: its seal starts the edge window", () => {
    expect(
      publishIndicator({
        own: idle,
        jobs: [job({ status: "sealed", seenAt: 5_000, sealedAt: 5_000 })],
        studioIsDeployer: true,
        now: 6_000,
      }),
    ).toEqual({
      kind: "reaching",
      mine: false,
      everywhereAt: 5_000 + EDGE_CACHE_MS,
    });
  });

  test("managed: a Studio opened after the seal reads it off the feed", () => {
    expect(
      publishIndicator({
        own: idle,
        deployments: [row({ updatedAt: new Date(50_000).toISOString() })],
        studioIsDeployer: true,
        now: 70_000,
      }),
    ).toEqual({
      kind: "reaching",
      mine: false,
      everywhereAt: 50_000 + EDGE_CACHE_MS,
    });
  });

  test("connected: a sealed job is a push CI has yet to build, so the feed says it", () => {
    expect(
      publishIndicator({
        own: idle,
        jobs: [job({ status: "sealed", seenAt: 5_000, sealedAt: 5_000 })],
        deployments: [row({ state: "pending", isLive: false })],
        now: 6_000,
      }),
    ).toEqual({ kind: "building", count: 1 });
  });

  test("a newer publish going live clears an older failure of ours", () => {
    expect(
      publishIndicator({
        own: failedAt(5_000),
        jobs: [job({ status: "sealed", seenAt: 9_000, sealedAt: 9_000 })],
        deployments: [row({ updatedAt: new Date(9_000).toISOString() })],
        studioIsDeployer: true,
        now: 9_000 + EDGE_CACHE_MS,
      }),
    ).toEqual({ kind: "live" });
  });
});

test("nothing in flight and nothing published", () => {
  expect(publishIndicator({ own: idle, now: 0 })).toEqual({ kind: "none" });
});
