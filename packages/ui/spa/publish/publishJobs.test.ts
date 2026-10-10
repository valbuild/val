import type {
  PublishRequestStatus,
  PublishTabJob,
} from "@valbuild/shared/internal";
import type { StudioJobClient } from "./jobClient";
import {
  createPublishJobs,
  publishingPatchIds,
  heldByContent,
  type PublishJobsState,
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
    pressMerge: async () => ({ request: { kind: "publishing" }, job: null }),
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

/*
 * Publish in a proposal is a publish like any other from its press on:
 * built here, followed, announced. Only its Try again is its own -- the merge
 * pressed anew, never the site's queue, which would publish the site's
 * changes instead.
 */
test("a merge is tracked as a publish, and its Try again presses the merge again", async () => {
  const pressedMerges: string[] = [];
  const { client, calls } = fakeClient({
    pressMerge: async (proposal, requestId) => {
      pressedMerges.push(`${proposal} ${requestId}`);
      return { request: { kind: "publishing" }, job: job("J3") };
    },
  });
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
    requestId: "m1",
    request: { kind: "publishing" },
    job: { ...job("J1"), patches: ["merge:spring"] },
    merge: "spring",
  });
  await flush();
  expect(built).toEqual(["J1"]);
  expect(jobs.get().requests[0]).toMatchObject({
    requestId: "m1",
    merge: "spring",
  });
  // Nothing of the site's chain is held for it: it publishes no patch.
  expect(jobs.get().requests[0]!.patchIds).toBeUndefined();

  jobs.track({
    requestId: "m1",
    request: {
      kind: "failed",
      message: "a page failed to render",
      actions: ["try-again"],
      job: "J1",
    },
    job: null,
  });
  expect(await jobs.tryAgain("m1")).toEqual({ ok: true });
  await flush();
  expect(calls.filter((c) => c.startsWith("try-again"))).toEqual([]);
  expect(pressedMerges).toHaveLength(1);
  expect(pressedMerges[0]).toMatch(/^spring /);
  const requests = jobs.get().requests;
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ merge: "spring" });
  expect(requests[0]!.requestId).not.toBe("m1");
  expect(built).toEqual(["J1", "J3"]);
});

test("a try again a builder tab pressed replaces the failed request, and holds what both sent", async () => {
  const { client } = fakeClient();
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
    patchIds: ["p1"],
  });
  // Followed without its job: the tab that pressed it builds that.
  jobs.track({
    requestId: "r2",
    request: { kind: "publishing" },
    job: null,
    patchIds: ["p2"],
    replaces: "r1",
  });
  await flush();
  expect(jobs.get().requests).toEqual([
    expect.objectContaining({ requestId: "r2", patchIds: ["p1", "p2"] }),
  ]);
  expect(built).toEqual([]);
});

test("a request told again, without what it sent, keeps what it was told first", async () => {
  // A builder tab reloaded mid-publish says what it follows again, but no
  // longer knows the changes its press sent.
  const { client } = fakeClient();
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => handedOff(j.id),
    takesQueuedWork: () => false,
  });
  jobs.track({
    requestId: "r1",
    request: { kind: "queued" },
    job: null,
    patchIds: ["p1", "p2"],
  });
  jobs.track({
    requestId: "r1",
    request: { kind: "publishing" },
    job: null,
    patchIds: [],
  });
  await flush();
  expect(jobs.get().requests).toEqual([
    expect.objectContaining({
      requestId: "r1",
      status: { kind: "publishing" },
      patchIds: ["p1", "p2"],
    }),
  ]);
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

test("a queued press that goes Live in the hand-off's refresh still holds what its job took", async () => {
  const { client, statuses } = fakeClient({
    next: async () => ({ ...job("J1"), patches: ["p1", "p2"] }),
  });
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    // Sealed by the time the tab asks where its presses are.
    build: async (j) => {
      statuses.set("r1", { kind: "live", commit: "C1" });
      return handedOff(j.id);
    },
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
  expect(jobs.get().requests[0]!.status.kind).toBe("live");
  expect([...publishingPatchIds(jobs.get())].sort()).toEqual(["p1", "p2"]);
});

/*
 * r1 sent p1 and was answered without a job. Another tab's job published p1,
 * and before this tab's refresh saw r1 go Live, it ran J2 -- which took p2
 * alone. r1 is not J2's: it must not take J2's changes, or J2 failing could
 * never give p2 back from under r1's sealed hold.
 */
test("a press another tab's job published does not take this job's changes", async () => {
  const { client, statuses } = fakeClient({
    next: async () => ({ ...job("J2"), patches: ["p2"] }),
  });
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => {
      statuses.set("r1", { kind: "live", commit: "C1" });
      return handedOff(j.id);
    },
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
  expect(jobs.get().requests[0]!.status.kind).toBe("live");
  expect(jobs.get().requests[0]!.patchIds).toEqual(["p1"]);
  expect([...publishingPatchIds(jobs.get())]).toEqual(["p1"]);
});

/*
 * r2 sent [p1, p2], captured before the publish ahead of it (J1, which took
 * p1) was marked applied. J2 then took p2, and p3 saved since. r2 is J2's, so
 * it holds p3 too -- or Publish was offered over p3 while J2 published it.
 */
test("a press naming a change the publish before it took is still its job's", async () => {
  const { client } = fakeClient({
    next: async () => ({ ...job("J2"), patches: ["p2", "p3"] }),
  });
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: async (j) => handedOff(j.id),
    takesQueuedWork: () => true,
  });
  jobs.track({
    requestId: "r2",
    request: { kind: "publishing" },
    job: null,
    patchIds: ["p1", "p2"],
  });
  jobs.nudge();
  await flush();
  expect([...publishingPatchIds(jobs.get())].sort()).toEqual([
    "p1",
    "p2",
    "p3",
  ]);
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

describe("publishingPatchIds with what content reports", () => {
  const nothingPressedHere = { requests: [], running: null };

  test("a publish pressed on another tab or device holds its changes here too", () => {
    expect([...publishingPatchIds(nothingPressedHere, ["p1"])]).toEqual(["p1"]);
  });

  test("this tab's own press counts before content has said so", () => {
    const pressed = {
      requests: [
        {
          requestId: "r1",
          pressedAt: 0,
          status: { kind: "publishing" as const },
          patchIds: ["p2"],
        },
      ],
      running: null,
    };
    expect([...publishingPatchIds(pressed, ["p1"])].sort()).toEqual([
      "p1",
      "p2",
    ]);
  });

  test("content not saying is the same as before it could", () => {
    expect(publishingPatchIds(nothingPressedHere, undefined).size).toBe(0);
  });

  /*
   * valbuild/home's `pnpm loop`, step 5b: the publish of edit A fails at
   * verify. The toast says so at once -- this tab reads its request -- but
   * the last word content sent about what is publishing was from while the
   * job ran, and still named A. Publish read "Publishing" over A until
   * content spoke again, which with a socket up is a `patches` message that
   * can be lost, and otherwise the next `/stat`.
   */
  describe("a press of ours that failed gives its changes back", () => {
    const failedAt = (
      settledAt: number,
      actions: Extract<PublishRequestStatus, { kind: "failed" }>["actions"] = [
        "try-again",
        "discard",
      ],
    ): PublishJobsState => ({
      requests: [
        {
          requestId: "r1",
          pressedAt: 0,
          settledAt,
          status: {
            kind: "failed",
            message: "verify failed 3 times",
            actions,
            job: "J1",
          },
          patchIds: ["p1"],
        },
      ],
      running: null,
    });

    test("over what content said before it failed", () => {
      expect(publishingPatchIds(failedAt(10_000), ["p1"], 5_000).size).toBe(0);
    });

    test("but not over what content said after: another publish took them", () => {
      expect([...publishingPatchIds(failedAt(10_000), ["p1"], 15_000)]).toEqual(
        ["p1"],
      );
    });

    test("and only its own: another publish's changes stay held", () => {
      expect([
        ...publishingPatchIds(failedAt(10_000), ["p1", "p2"], 5_000),
      ]).toEqual(["p2"]);
    });

    test("not after the seal: a build CI failed has published them", () => {
      const sealed = failedAt(10_000, ["re-run-build"]);
      expect([...publishingPatchIds(sealed, ["p1"], 5_000)]).toEqual(["p1"]);
    });
  });
});

test("a press that goes Live while its job is still building holds what its job took", async () => {
  // The refresh that settles it runs DURING the build, so deciding which
  // presses the job carries after the build missed it, and p2 lit Publish.
  const { client, statuses } = fakeClient({
    next: async () => ({ ...job("J1"), patches: ["p1", "p2"] }),
  });
  let finish!: () => void;
  const jobs = createPublishJobs({
    client,
    tab: "ada",
    build: (j) =>
      new Promise((resolve) => {
        finish = () => resolve(handedOff(j.id));
      }),
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
  statuses.set("r1", { kind: "live", commit: "C1" });
  jobs.nudge();
  await flush();
  expect(jobs.get().requests[0]!.status.kind).toBe("live");
  finish();
  await flush();
  expect([...publishingPatchIds(jobs.get())].sort()).toEqual(["p1", "p2"]);
});

describe("Try again holds its changes from the click", () => {
  const failed = {
    kind: "failed" as const,
    message: "build",
    actions: ["try-again" as const],
    job: "J1",
  };

  function retrying(
    answer: Promise<Awaited<ReturnType<StudioJobClient["tryAgain"]>>>,
  ) {
    const { client } = fakeClient({ tryAgain: () => answer });
    const jobs = createPublishJobs({
      client,
      tab: "ada",
      build: async (j) => handedOff(j.id),
      takesQueuedWork: () => false,
    });
    jobs.track({
      requestId: "r1",
      request: failed,
      job: null,
      patchIds: ["p1"],
    });
    return jobs;
  }

  test("before content has answered", async () => {
    // Until it answers, the failed press is settled and holds nothing.
    const jobs = retrying(new Promise(() => {}));
    expect(publishingPatchIds(jobs.get()).size).toBe(0);
    void jobs.tryAgain("r1", { patchIds: ["p2"] });
    await flush();
    expect([...publishingPatchIds(jobs.get())].sort()).toEqual(["p1", "p2"]);
  });

  test("and gives them back if the retry could not be sent", async () => {
    const jobs = retrying(Promise.reject(new Error("offline")));
    const result = await jobs.tryAgain("r1", { patchIds: ["p2"] });
    expect(result.ok).toBe(false);
    expect(publishingPatchIds(jobs.get()).size).toBe(0);
  });
});

describe("heldByContent", () => {
  const none: ReadonlySet<string> = new Set();

  /*
   * A hold outlives content's report only until this Studio's store has
   * taken the seal in. Kept past that, every publish added its changes to the
   * set for the life of the Studio, and every update scanned them again.
   */
  test("lets a change go once the store has it committed or forgotten", () => {
    const sealed = {
      publishingPatches: [],
      patches: ["p1"],
      appliedPatches: ["p1"],
    };
    const adopting = heldByContent(new Set(["p1"]), sealed, () => true);
    expect([...adopting]).toEqual(["p1"]);
    expect(heldByContent(adopting, sealed, () => false).size).toBe(0);
    // And once content stops listing it too.
    expect(
      heldByContent(
        adopting,
        { publishingPatches: [], patches: [], appliedPatches: [] },
        () => false,
      ).size,
    ).toBe(0);
  });

  test("never lets go of what content says is publishing now", () => {
    expect([
      ...heldByContent(
        none,
        { publishingPatches: ["p1"], patches: ["p1"], appliedPatches: [] },
        () => false,
      ),
    ]).toEqual(["p1"]);
  });

  test("holds what content says a running publish holds", () => {
    expect([
      ...heldByContent(none, {
        publishingPatches: ["p1"],
        patches: ["p1", "p2"],
        appliedPatches: [],
      }),
    ]).toEqual(["p1"]);
  });

  test("gives a change back when content lists it as pending again", () => {
    // The publish failed, was cancelled or was interrupted.
    expect(
      heldByContent(new Set(["p1"]), {
        publishingPatches: [],
        patches: ["p1"],
        appliedPatches: [],
      }).size,
    ).toBe(0);
  });

  test("keeps holding a change content reports applied", () => {
    // Sealed: the patch store takes the applied list and the new base on its
    // own schedule, and the change reads as unpublished until it has.
    expect([
      ...heldByContent(new Set(["p1"]), {
        publishingPatches: [],
        patches: ["p1"],
        appliedPatches: ["p1"],
      }),
    ]).toEqual(["p1"]);
  });

  test("keeps holding a change content no longer lists: it is in the base", () => {
    expect([
      ...heldByContent(new Set(["p1"]), {
        publishingPatches: [],
        patches: [],
        appliedPatches: [],
      }),
    ]).toEqual(["p1"]);
  });

  test("a content service that does not say is no news", () => {
    const held = new Set(["p1"]);
    expect(heldByContent(held, { patches: ["p1"] })).toBe(held);
  });

  test("the same answer keeps the same set", () => {
    const held = new Set(["p1"]);
    expect(
      heldByContent(held, {
        publishingPatches: ["p1"],
        patches: ["p1"],
        appliedPatches: [],
      }),
    ).toBe(held);
  });
});
