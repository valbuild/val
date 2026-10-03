import type { PublishRequestStatus } from "@valbuild/shared/internal";
import { deployPercent } from "./deployProgress";
import type { PublishJobsState, TrackedPublish } from "./publishJobs";
import type { DeployPhase } from "./runStudioDeploy";
import type { JobPhase } from "./runStudioJob";
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

test("a job built in this tab never goes backwards, from the press to Live", () => {
  const publishing: PublishRequestStatus = { kind: "publishing" };
  const runningDeploy = (phase: DeployPhase): StudioDeployState => ({
    status: "running",
    phase,
    startedAt: 1_500,
    phaseStartedAt: 1_500,
    commit: null,
  });
  const job = (phase: JobPhase | null): PublishJobsState["running"] => ({
    jobId: "J1",
    phase,
  });
  const build: DeployPhase[] = [
    { kind: "getting-ready" },
    { kind: "reading" },
    { kind: "building" },
    { kind: "declaring" },
    { kind: "uploading", done: 3, total: 7 },
    { kind: "confirming" },
  ];
  const views = [
    // Pressed, and the job is being prepared.
    publishProgress(idle, jobs(publishing, {}, job(null)), 1_100),
    publishProgress(
      idle,
      jobs(publishing, {}, job({ kind: "preparing" })),
      1_200,
    ),
    // The build, in this tab.
    ...build.map((phase) =>
      publishProgress(
        runningDeploy(phase),
        jobs(publishing, {}, job({ kind: "deploying", phase })),
        2_000,
      ),
    ),
    // Uploaded, and reporting it to content.
    publishProgress(
      uploaded,
      jobs(publishing, {}, job({ kind: "handing-off" })),
      5_100,
    ),
    // Content has it.
    publishProgress(
      uploaded,
      jobs(publishing, { handedOffAt: 5_200 }, job({ kind: "handing-off" })),
      5_200,
    ),
    publishProgress(uploaded, jobs(publishing, { handedOffAt: 5_200 }), 5_300),
  ];
  const percents = views.map((view) =>
    view.status === "running" ? deployPercent(view.phase) : 100,
  );
  expect(percents).toEqual([...percents].sort((a, b) => a - b));
  expect(views.at(-1)).toMatchObject({ phase: { kind: "verifying" } });
});

test("a connected job CI builds does not step back after the hand-off", () => {
  const before = publishProgress(
    idle,
    jobs(
      { kind: "publishing" },
      {},
      { jobId: "J1", phase: { kind: "handing-off" } },
    ),
    2_000,
  );
  const after = publishProgress(
    idle,
    jobs({ kind: "publishing" }, { handedOffAt: 2_500, builtBy: "ci" }),
    3_000,
  );
  if (before.status !== "running" || after.status !== "running") {
    throw new Error("expected both to be running");
  }
  expect(deployPercent(before.phase)).toBeLessThanOrEqual(
    deployPercent(after.phase),
  );
});
