import type {
  PublishRequestStatus,
  PublishTabJob,
} from "@valbuild/shared/internal";
import type { StudioJobClient } from "./jobClient";
import {
  createPublishJobs,
  publishingPatchIds,
  type TrackedPublish,
} from "./publishJobs";
import type { StudioJobResult } from "./runStudioJob";

const job = (id: string): PublishTabJob => ({
  id,
  step: "prepare",
  base: null,
  patches: ["p1"],
});

function fakeClient(over: Partial<StudioJobClient> = {}) {
  const statuses = new Map<string, PublishRequestStatus>();
  const calls: string[] = [];
  const client: StudioJobClient = {
    press: async () => ({ request: { kind: "publishing" }, job: null }),
    tryAgain: async (requestId) => {
      calls.push(`try-again ${requestId}`);
      return { request: { kind: "publishing" }, job: job("J2") };
    },
    requestStatus: async (requestId) => {
      calls.push(`status ${requestId}`);
      return statuses.get(requestId) ?? { kind: "publishing" };
    },
    next: async () => {
      calls.push("next");
      return null;
    },
    prepare: async () => {
      throw new Error("not used: build is faked");
    },
    step: async () => null,
    renew: async () => false,
    cancel: async () => true,
    discard: async (jobId) => {
      calls.push(`discard ${jobId}`);
      return [];
    },
    newestCiRun: async () => null,
    ...over,
  };
  return { client, statuses, calls };
}

const handedOff = (jobId: string): StudioJobResult => ({
  status: "handed-off",
  jobId,
  built: true,
});

test("a press with a job is built, and is then content's until it is Live", async () => {
  const { client, statuses } = fakeClient();
  const built: string[] = [];
  const settled: TrackedPublish[] = [];
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => {
      built.push(j.id);
      return handedOff(j.id);
    },
    takesQueuedWork: () => true,
    onSettled: (r) => settled.push(r),
    now: () => 1_000,
  });
  jobs.track({
    requestId: "r1",
    request: { kind: "publishing" },
    job: job("J1"),
  });
  await flush();
  expect(built).toEqual(["J1"]);
  expect(jobs.get().running).toBeNull();
  expect(jobs.get().requests).toEqual([
    {
      requestId: "r1",
      pressedAt: 1_000,
      status: { kind: "publishing" },
      handedOffAt: 1_000,
      builtBy: "studio",
      jobId: "J1",
    },
  ]);

  // Content sealed it; the nudge is how the tab hears.
  statuses.set("r1", { kind: "live", commit: "C1" });
  jobs.nudge();
  await flush();
  expect(jobs.get().requests[0]!.status).toEqual({
    kind: "live",
    commit: "C1",
  });
  expect(settled.map((r) => r.status.kind)).toEqual(["live"]);

  // Settled once: another nudge re-reads nothing and announces nothing.
  jobs.nudge();
  await flush();
  expect(settled).toHaveLength(1);
});

test("a failed step is run again while the job is still this tab's", async () => {
  let renewals = 0;
  const { client } = fakeClient({
    // Content kept the job at its step twice, then failed it.
    renew: async () => ++renewals < 3,
  });
  let runs = 0;
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => {
      runs++;
      return { status: "failed", jobId: j.id, message: "rolldown" };
    },
    takesQueuedWork: () => false,
  });
  jobs.track({
    requestId: "r1",
    request: { kind: "publishing" },
    job: job("J1"),
  });
  await flush();
  expect(runs).toBe(3);
  expect(jobs.get().running).toBeNull();
});

test("a free tab that can build takes queued work, and one that cannot does not", async () => {
  const handed = fakeClient({
    next: async () => job("J9"),
  });
  const built: string[] = [];
  let nextCalls = 0;
  const client: StudioJobClient = {
    ...handed.client,
    next: async () => (++nextCalls === 1 ? job("J9") : null),
  };
  const builder = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => {
      built.push(j.id);
      return handedOff(j.id);
    },
    takesQueuedWork: () => true,
  });
  builder.start();
  await flush();
  builder.stop();
  expect(built).toEqual(["J9"]);

  const overlay = fakeClient();
  const page = createPublishJobs({
    client: overlay.client,
    tab: "bea",
    build: async (j) => handedOff(j.id),
    takesQueuedWork: () => false,
  });
  page.start();
  page.nudge();
  await flush();
  page.stop();
  expect(overlay.calls).not.toContain("next");
});

test("Try again replaces the failed request with a new press, and builds its job", async () => {
  const { client, calls } = fakeClient();
  const built: string[] = [];
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => {
      built.push(j.id);
      return handedOff(j.id);
    },
    takesQueuedWork: () => false,
  });
  jobs.track({
    requestId: "r1",
    request: {
      kind: "failed",
      message: "a page failed to render",
      actions: ["try-again", "discard"],
      job: "J1",
    },
    job: null,
  });
  expect(await jobs.tryAgain("r1")).toEqual({ ok: true });
  await flush();
  expect(calls.filter((c) => c.startsWith("try-again"))).toHaveLength(1);
  const requests = jobs.get().requests;
  expect(requests).toHaveLength(1);
  expect(requests[0]!.requestId).not.toBe("r1");
  expect(built).toEqual(["J2"]);
});

test("Discard is pressed on the failed request's job", async () => {
  const discarded: string[] = [];
  const { client } = fakeClient({
    discard: async (jobId) => {
      discarded.push(jobId);
      return ["p7"];
    },
  });
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => handedOff(j.id),
    takesQueuedWork: () => false,
  });
  jobs.track({
    requestId: "r1",
    request: { kind: "publishing" },
    job: null,
  });
  // Not failed: nothing to discard.
  expect((await jobs.discard("r1")).ok).toBe(false);
  jobs.track({
    requestId: "r1",
    request: {
      kind: "failed",
      message: "no",
      actions: ["try-again", "discard"],
      job: "J1",
    },
    job: null,
  });
  expect(await jobs.discard("r1")).toEqual({ ok: true, stillHeld: ["p7"] });
  expect(discarded).toEqual(["J1"]);
  expect(jobs.get().requests).toEqual([]);
});

test("the poll re-reads what has not settled, and only that", async () => {
  jest.useFakeTimers();
  try {
    const { client, calls, statuses } = fakeClient();
    const jobs = createPublishJobs({
      client,
      tab: "ada",
      build: async (j) => handedOff(j.id),
      takesQueuedWork: () => false,
      pollMs: 1_000,
    });
    jobs.track({ requestId: "r1", request: { kind: "queued" }, job: null });
    jobs.track({
      requestId: "r2",
      request: { kind: "live", commit: "C0" },
      job: null,
    });
    jobs.start();
    statuses.set("r1", { kind: "nothing-to-publish" });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(calls.filter((c) => c.startsWith("status"))).toEqual(["status r1"]);
    await jest.advanceTimersByTimeAsync(3_000);
    // Settled: the poll stops asking.
    expect(calls.filter((c) => c.startsWith("status"))).toEqual(["status r1"]);
    jobs.dismiss("r2");
    expect(jobs.get().requests.map((r) => r.requestId)).toEqual(["r1"]);
    jobs.stop();
  } finally {
    jest.useRealTimers();
  }
});

test("a press's changes are not offered again until it fails, and a retry's are the same", async () => {
  const { client, statuses } = fakeClient();
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => handedOff(j.id),
    takesQueuedWork: () => false,
  });
  jobs.track({
    requestId: "r1",
    request: { kind: "publishing" },
    job: job("J1"),
    patchIds: ["p1", "p2"],
  });
  await flush();
  // Handed off: content has the job, and the changes are still on their way.
  expect(jobs.get().requests[0]!.handedOffAt).toBeDefined();
  expect([...publishingPatchIds(jobs.get())]).toEqual(["p1", "p2"]);

  // Failed: pending again, and Publish is how to retry them.
  statuses.set("r1", {
    kind: "failed",
    message: "build",
    actions: ["try-again"],
    job: "J1",
  });
  jobs.nudge();
  await flush();
  expect(publishingPatchIds(jobs.get()).size).toBe(0);

  // Try again sends what the failed press did.
  expect(await jobs.tryAgain("r1")).toEqual({ ok: true });
  await flush();
  expect([...publishingPatchIds(jobs.get())]).toEqual(["p1", "p2"]);

  // Live: shipped, and still not something to press Publish for -- even
  // before `/stat` has said they are applied.
  const retried = jobs.get().requests[0]!.requestId;
  statuses.set(retried, { kind: "live", commit: "C1" });
  jobs.nudge();
  await flush();
  expect([...publishingPatchIds(jobs.get())]).toEqual(["p1", "p2"]);

  // Dismissed: gone, by which time `/stat` has long said so.
  jobs.dismiss(retried);
  expect(publishingPatchIds(jobs.get()).size).toBe(0);
});

test("a retry holds what is pending at the press, edits since the failure included", async () => {
  const { client, statuses } = fakeClient({
    // The new job takes everything pending: p1, and p3, saved after the
    // failure. p2 is a change content took that this tab did not name.
    tryAgain: async () => ({
      request: { kind: "publishing" },
      job: { ...job("J2"), patches: ["p1", "p2", "p3"] },
    }),
  });
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => handedOff(j.id),
    takesQueuedWork: () => false,
  });
  jobs.track({
    requestId: "r1",
    request: { kind: "publishing" },
    job: job("J1"),
    patchIds: ["p1"],
  });
  await flush();
  statuses.set("r1", {
    kind: "failed",
    message: "build",
    actions: ["try-again"],
    job: "J1",
  });
  jobs.nudge();
  await flush();
  expect(publishingPatchIds(jobs.get()).size).toBe(0);

  expect(await jobs.tryAgain("r1", { patchIds: ["p1", "p3"] })).toEqual({
    ok: true,
  });
  await flush();
  expect([...publishingPatchIds(jobs.get())].sort()).toEqual([
    "p1",
    "p2",
    "p3",
  ]);
});

test("a build that failed after the seal keeps its changes: they are published", async () => {
  const { client, statuses } = fakeClient();
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => handedOff(j.id),
    takesQueuedWork: () => false,
  });
  jobs.track({
    requestId: "r1",
    request: { kind: "publishing" },
    job: job("J1"),
    patchIds: ["p1"],
  });
  await flush();
  // Connected: content sealed it, and CI's build of the commit failed.
  statuses.set("r1", {
    kind: "failed",
    message: "CI failed",
    actions: ["re-run-build"],
    job: "J1",
  });
  jobs.nudge();
  await flush();
  expect(jobs.get().requests[0]!.status.kind).toBe("failed");
  expect([...publishingPatchIds(jobs.get())]).toEqual(["p1"]);
});

test("a press queued without a job holds what the job it joins takes", async () => {
  const { client } = fakeClient({
    // p2 was saved after the press queued; the job takes both.
    next: async () => ({ ...job("J1"), patches: ["p1", "p2"] }),
  });
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => handedOff(j.id),
    takesQueuedWork: () => true,
  });
  jobs.track({
    requestId: "r1",
    request: { kind: "publishing" },
    job: null,
    patchIds: ["p1"],
  });
  jobs.nudge();
  await flush();
  expect(jobs.get().requests[0]!.jobId).toBe("J1");
  expect([...publishingPatchIds(jobs.get())].sort()).toEqual(["p1", "p2"]);
});

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

test("a job that ended here is not taken again when content hands it back", async () => {
  const { client } = fakeClient({ next: async () => job("J1") });
  let runs = 0;
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => {
      runs++;
      return { status: "lost", jobId: j.id };
    },
    takesQueuedWork: () => true,
  });
  jobs.start();
  await flush();
  jobs.nudge();
  await flush();
  jobs.stop();
  expect(runs).toBe(1);
});

test("a job CI builds is handed off unbuilt, and shown as CI's", async () => {
  const { client } = fakeClient();
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => ({ status: "handed-off", jobId: j.id, built: false }),
    takesQueuedWork: () => false,
    now: () => 1_000,
  });
  jobs.track({
    requestId: "r1",
    request: { kind: "publishing" },
    job: job("J1"),
  });
  await flush();
  expect(jobs.get().requests[0]).toMatchObject({ builtBy: "ci" });
});

test("a press queued behind the job being built is not handed off with it", async () => {
  const { client, statuses } = fakeClient();
  let finish!: () => void;
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: (j) =>
      new Promise((resolve) => {
        finish = () => resolve(handedOff(j.id));
      }),
    takesQueuedWork: () => false,
    now: () => 1_000,
  });
  jobs.track({
    requestId: "r1",
    request: { kind: "publishing" },
    job: job("J1"),
  });
  await flush();
  // Pressed again while J1 builds: content queues it for the next job.
  jobs.track({ requestId: "r2", request: { kind: "queued" }, job: null });
  statuses.set("r2", { kind: "queued" });
  finish();
  await flush();
  const [first, second] = jobs.get().requests;
  expect(first).toMatchObject({ requestId: "r1", handedOffAt: 1_000 });
  expect(second!.handedOffAt).toBeUndefined();
});
