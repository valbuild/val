import { initVal, type PatchId } from "@valbuild/core";
import type { ParentRef } from "@valbuild/core/patch";
import { createSystem } from "./createSystem";
import {
  FAILED_RETRY_MAX_MS,
  FAILED_RETRY_MS,
  failedRetryMs,
  isSaveStuck,
  type SaveResult,
} from "./PatchSync";
import { mfp, sp } from "./testSystem";
import type { SystemEvent } from "./types";

/**
 * A save the content service failed to take: it answered 500, or could not be
 * reached (the server's 502 `service-error`).
 *
 * Found against a self-hosted content service whose database was missing a
 * column. The server turned the 500 into a 400 `patch-error`, the sync took
 * that as a bad patch and DROPPED it, the field went back to its old value
 * and the status bar said "All changes saved". Nothing was wrong with the
 * patch. So: keep it, say the save failed, and send it again on Try again.
 */
const module = () => {
  const { c, s } = initVal();
  return c.define(
    "/t.val.ts",
    s.object({ title: s.string(), body: s.string() }),
    { title: "Hello", body: "World" },
  );
};

const head: ParentRef = { type: "head", headBaseSha: "sha" };

const FAILURE = {
  message:
    "The content service at localhost:4568 answered with an error, so Val could not save your change.",
  details:
    'HTTP 500 Internal Server Error from the content service at localhost:4568: Internal Server Error: column "first_paid_at" does not exist',
};

function rig() {
  const requests: PatchId[][] = [];
  /** What the server does with the next write; it saves when this is null. */
  let answer: ((ids: PatchId[]) => SaveResult) | null = null;
  /** The timed retries the sync is waiting on. The save backoff is 0 here. */
  const timed: { ms: number; wake: () => void }[] = [];
  const events: SystemEvent[] = [];
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return () => `p-${++next}` as PatchId;
    })(),
    savePatches: async ({ patches }) => {
      const ids = patches.map((entry) => entry.patchId);
      requests.push(ids);
      if (answer !== null) return answer(ids);
      return {
        status: "saved",
        newPatchIds: ids,
        parentRef: { type: "patch", patchId: ids[ids.length - 1] },
      };
    },
    publishPatches: async () => ({ status: "published" }),
    saveBackoffMs: () => 0,
    saveSleep: (ms) =>
      ms === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            timed.push({ ms, wake: resolve });
          }),
  });
  system.patchSync.events.on("patch:save-failed", (event) => {
    events.push(event);
  });
  system.patchSync.events.on("patch:save-rejected", (event) => {
    events.push(event);
  });
  system.host.receive([module()]);
  system.stat.receiveStat({ patches: [], baseSha: "sha" });
  const edit = async (value: string): Promise<PatchId> => {
    const created = await system.patchStore.createPatch(mfp("/t.val.ts"), [
      { op: "replace", path: ["title"], value },
    ]);
    if (created.status !== "created") throw new Error(created.message);
    return created.record.patchId;
  };
  const failAll = () => {
    answer = () => ({
      status: "server-error",
      saved: { newPatchIds: [], parentRef: head },
      ...FAILURE,
    });
  };
  return {
    system,
    requests,
    events,
    timed,
    edit,
    failAll,
    recover: () => {
      answer = null;
    },
    setAnswer: (next: ((ids: PatchId[]) => SaveResult) | null) => {
      answer = next;
    },
  };
}

/** Let the write loop's own promises run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const title = (system: ReturnType<typeof rig>["system"]) =>
  system.sourceStore.peek(sp('/t.val.ts?p="title"'));

describe("a save the content service failed to take", () => {
  it("keeps what was typed rather than reverting it", async () => {
    const { system, failAll, edit } = rig();
    failAll();
    const record = await edit("typed");
    await system.patchSync.flush();
    await settle();

    expect(system.patchStore.isPending(record)).toBe(true);
    expect(title(system)).toMatchObject({ status: "ready", data: "typed" });
  });

  it("tries once more before saying so, then holds the queue as failed", async () => {
    const { system, failAll, edit, requests, events } = rig();
    failAll();
    const record = await edit("typed");
    await system.patchSync.flush();
    await settle();

    // The quick retry is for the blip; the second failure is real.
    expect(requests).toEqual([[record], [record]]);
    const state = system.patchSync.currentState();
    expect(state).toEqual({
      status: "failed",
      patches: [record],
      message: FAILURE.message,
      details: FAILURE.details,
      attempt: 2,
    });
    expect(isSaveStuck(state)).toBe(true);
    expect(events).toEqual([
      {
        type: "patch:save-failed",
        patches: [record],
        message: FAILURE.message,
        details: FAILURE.details,
        attempt: 2,
      },
    ]);
  });

  it("is never reported as a rejection", async () => {
    const { system, failAll, edit, events } = rig();
    failAll();
    await edit("typed");
    await system.patchSync.flush();
    await settle();

    expect(events.map((event) => event.type)).not.toContain(
      "patch:save-rejected",
    );
  });

  it("does not send an edit made while held, one save per keystroke", async () => {
    const { system, failAll, edit, requests } = rig();
    failAll();
    const first = await edit("typed");
    await system.patchSync.flush();
    await settle();
    const sent = requests.length;

    const second = await edit("typed more");
    await system.patchSync.flush();
    await settle();

    expect(requests.length).toBe(sent);
    // ...but it is part of what is held, so it goes up with the rest.
    expect(system.patchSync.currentState()).toMatchObject({
      status: "failed",
      patches: [first, second],
    });
  });

  it("Try again sends the same save, and it is saved once the service recovers", async () => {
    const { system, failAll, recover, edit, requests } = rig();
    failAll();
    const record = await edit("typed");
    await system.patchSync.flush();
    await settle();

    recover();
    await system.patchSync.retry();
    await settle();

    expect(requests[requests.length - 1]).toEqual([record]);
    expect(system.patchStore.isPending(record)).toBe(false);
    expect(system.patchSync.currentState()).toEqual({ status: "in-sync" });
    expect(title(system)).toMatchObject({ status: "ready", data: "typed" });
  });

  it("Try again that fails again goes straight back to failed, without a second quick retry", async () => {
    const { system, failAll, edit, requests } = rig();
    failAll();
    await edit("typed");
    await system.patchSync.flush();
    await settle();
    const sent = requests.length;

    await system.patchSync.retry();
    await settle();

    expect(requests.length).toBe(sent + 1);
    expect(system.patchSync.currentState()).toMatchObject({
      status: "failed",
      attempt: 3,
    });
  });

  it("is sent again by itself after a while, so an open tab saves once the service is back", async () => {
    const { system, failAll, recover, edit, timed } = rig();
    failAll();
    const record = await edit("typed");
    await system.patchSync.flush();
    await settle();

    expect(timed.map((wait) => wait.ms)).toEqual([FAILED_RETRY_MS]);
    recover();
    timed[0].wake();
    await settle();
    await system.patchSync.flush();

    expect(system.patchStore.isPending(record)).toBe(false);
  });

  it("keeps the part of a batch the service took before it failed", async () => {
    const { system, setAnswer, edit, requests } = rig();
    // Takes the first edit (`p-1`, from the rig's id counter) and fails on
    // anything after it -- in whatever batches the queue sends them.
    const takes = "p-1" as PatchId;
    setAnswer((ids) => ({
      status: "server-error",
      saved: {
        newPatchIds: ids[0] === takes ? [takes] : [],
        parentRef: { type: "patch", patchId: takes },
      },
      ...FAILURE,
    }));
    const first = await edit("one");
    const second = await edit("two");
    expect(first).toBe(takes);
    await system.patchSync.flush();
    await settle();

    expect(system.patchStore.isPending(first)).toBe(false);
    expect(system.patchStore.isPending(second)).toBe(true);
    expect(requests[requests.length - 1]).toEqual([second]);
    expect(system.patchSync.currentState()).toMatchObject({
      status: "failed",
      patches: [second],
    });
  });

  it("backs off the timed retry, within bounds", () => {
    expect(failedRetryMs(1)).toBe(FAILED_RETRY_MS);
    expect(failedRetryMs(2)).toBe(FAILED_RETRY_MS * 2);
    expect(failedRetryMs(100)).toBe(FAILED_RETRY_MAX_MS);
  });
});
