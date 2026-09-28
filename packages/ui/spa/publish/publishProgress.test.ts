import type { PublishRequestStatus } from "@valbuild/shared/internal";
import type { PublishJobsState, TrackedPublish } from "./publishJobs";
import { publishProgress } from "./publishProgress";
import type { StudioDeployState } from "./useStudioDeploy";

const idle: StudioDeployState = { status: "idle" };

const jobs = (
  status: PublishRequestStatus,
  over: Partial<TrackedPublish> = {},
  running: PublishJobsState["running"] = null,
): PublishJobsState => ({
  requests: [{ requestId: "r1", pressedAt: 1_000, status, ...over }],
  running,
});

const uploaded: StudioDeployState = {
  status: "done",
  result: { status: "uploaded", publishId: "pub1" },
  ms: 4_000,
  steps: [{ kind: "building", ms: 3_000 }],
  commit: null,
  finishedAt: 5_000,
};

test("no press: the deploy is the whole story", () => {
  expect(publishProgress(idle, { requests: [], running: null }, 0)).toBe(idle);
});

test("a press waiting its turn reads as queued", () => {
  const view = publishProgress(idle, jobs({ kind: "queued" }), 2_000);
  expect(view).toMatchObject({
    status: "running",
    phase: { kind: "queued" },
    startedAt: 1_000,
  });
});

test("the tab's own build is shown as it runs", () => {
  const building: StudioDeployState = {
    status: "running",
    phase: { kind: "building" },
    startedAt: 1_500,
    phaseStartedAt: 1_500,
    commit: null,
  };
  expect(publishProgress(building, jobs({ kind: "publishing" }), 2_000)).toBe(
    building,
  );
});

test("after the hand-off, content is checking it -- with the build's steps kept", () => {
  const view = publishProgress(
    uploaded,
    jobs({ kind: "publishing" }, { handedOffAt: 5_000 }),
    6_000,
  );
  expect(view).toEqual({
    status: "running",
    phase: { kind: "verifying" },
    startedAt: 1_000,
    phaseStartedAt: 5_000,
    steps: [{ kind: "building", ms: 3_000 }],
    commit: null,
  });
});

test("Live is done, and names the commit that carried it", () => {
  const view = publishProgress(
    uploaded,
    jobs(
      { kind: "live", commit: "C1" },
      { handedOffAt: 5_000, settledAt: 9_000 },
    ),
    20_000,
  );
  expect(view).toEqual({
    status: "done",
    result: { status: "live", url: null },
    ms: 8_000,
    steps: [
      { kind: "building", ms: 3_000 },
      { kind: "verifying", ms: 4_000 },
    ],
    commit: "C1",
    finishedAt: 9_000,
  });
});

test("a job content failed says so, at the check", () => {
  const view = publishProgress(
    uploaded,
    jobs(
      {
        kind: "failed",
        message: "a page failed to render",
        actions: ["try-again", "discard"],
        job: "J1",
      },
      { handedOffAt: 5_000, settledAt: 7_000 },
    ),
    8_000,
  );
  expect(view).toMatchObject({
    status: "done",
    result: { status: "failed", message: "a page failed to render" },
    failedAt: "verifying",
  });
});

test("an update after the last press is the update's story", () => {
  const updated: StudioDeployState = {
    status: "done",
    result: { status: "live", url: null },
    ms: 1,
    steps: [],
    commit: "C9",
    finishedAt: 50_000,
  };
  expect(
    publishProgress(
      updated,
      jobs({ kind: "live", commit: "C1" }, { settledAt: 9_000 }),
      60_000,
    ),
  ).toBe(updated);
});

test("a job CI builds is building after the hand-off, not being checked", () => {
  const view = publishProgress(
    idle,
    jobs({ kind: "publishing" }, { handedOffAt: 5_000, builtBy: "ci" }),
    6_000,
  );
  expect(view).toMatchObject({
    status: "running",
    phase: { kind: "building" },
    phaseStartedAt: 5_000,
  });
});
