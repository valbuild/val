import { initVal, type PatchId } from "@valbuild/core";
import type { ParentRef } from "@valbuild/core/patch";
import { createSystem } from "./createSystem";
import {
  REFUSED_RETRY_MAX_MS,
  REFUSED_RETRY_MS,
  refusedRetryMs,
  type SaveResult,
} from "./PatchSync";
import { mfp } from "./testSystem";
import type { SystemEvent } from "./types";
import type { PlanRefusalErrorT } from "@valbuild/shared/internal";
import { onPlanRefusal, type PlanRefusal } from "../utils/planRefusal";

/**
 * A save Val Build refuses for the project's plan (a 403 that says why).
 *
 * Unlike a 400, the patch is fine: dropping it would throw away an edit over
 * a limit an owner can lift with one click. Unlike a network error, asking
 * again a second later gets the same answer. So the edit is kept, the queue is
 * held, and it is sent again after a while or when the shell says the plan
 * allows it.
 */
const module = () => {
  const { c, s } = initVal();
  return c.define(
    "/t.val.ts",
    s.object({ title: s.string(), body: s.string() }),
    { title: "Hello", body: "World" },
  );
};

const REFUSAL = {
  message:
    "t has used this week's 1,000 changes on the Free plan. Everything saved so far is kept.",
  error: {
    code: "limit:changes",
    fix: "upgrade",
    until: "2026-10-20T10:00:00.000Z",
    billingUrl: "https://admin.val.build/org/billing",
  },
};

const head: ParentRef = { type: "head", headBaseSha: "sha" };

function rig() {
  const requests: PatchId[][] = [];
  /** What the server does with the next write; it saves when this is null. */
  let answer: ((ids: PatchId[]) => SaveResult) | null = null;
  const waits: { ms: number; wake: () => void }[] = [];
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
      new Promise<void>((resolve) => {
        waits.push({ ms, wake: resolve });
      }),
  });
  system.patchSync.events.on("patch:save-refused", (event) => {
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
  const refuseAll = (
    refusal: { message: string; error: PlanRefusalErrorT } = REFUSAL,
  ) => {
    answer = () => ({
      status: "refused",
      saved: { newPatchIds: [], parentRef: head },
      refusal,
    });
  };
  /** The timed retries the sync is waiting on; the save backoff is 0 here. */
  const retries = () => waits.filter((wait) => wait.ms > 0);
  return {
    system,
    requests,
    events,
    waits,
    edit,
    refuseAll,
    retries,
    setAnswer: (next: ((ids: PatchId[]) => SaveResult) | null) => {
      answer = next;
    },
  };
}

/** Let the write loop's own promises run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a save refused for the plan", () => {
  it("keeps the edit rather than reverting it", async () => {
    const { system, refuseAll, edit } = rig();
    refuseAll();
    const record = await edit("kept");
    await system.patchSync.flush();

    expect(system.patchStore.pendingPatchIds()).toEqual([record]);
    expect(system.patchSync.currentState()).toEqual({
      status: "refused",
      patches: [record],
      message: REFUSAL.message,
    });
    system.dispose();
  });

  it("sends nothing while held, so an edit made meanwhile is not sent to be refused", async () => {
    const { system, refuseAll, edit, requests } = rig();
    refuseAll();
    const first = await edit("one");
    await system.patchSync.flush();
    const second = await edit("two");
    await system.patchSync.flush();

    expect(requests).toEqual([[first]]);
    expect(system.patchSync.currentState()).toMatchObject({
      status: "refused",
      patches: [first, second],
    });
    system.dispose();
  });

  it("marks the part of the batch the server took before refusing as saved", async () => {
    const { system, refuseAll, setAnswer, edit, requests } = rig();
    // Refused and held first, so the two edits go up together on resume.
    refuseAll();
    const first = await edit("one");
    await system.patchSync.flush();
    const second = await edit("two");
    // The week runs out between the two: the server takes the first.
    setAnswer((ids) => ({
      status: "refused",
      saved: {
        newPatchIds: ids.slice(0, 1),
        parentRef: { type: "patch", patchId: ids[0] },
      },
      refusal: REFUSAL,
    }));
    system.patchSync.resume();
    await system.patchSync.flush();

    expect(requests[requests.length - 1]).toEqual([first, second]);
    expect(system.patchStore.pendingPatchIds()).toEqual([second]);
    // The next write names the patch the server took as its parent.
    expect(system.patchSync.currentParentRef()).toEqual({
      type: "patch",
      patchId: first,
    });
    system.dispose();
  });

  it("is sent again when the shell says editing is allowed", async () => {
    const { system, refuseAll, setAnswer, edit, requests } = rig();
    refuseAll();
    const record = await edit("later");
    await system.patchSync.flush();
    setAnswer(null);

    system.patchSync.resume();
    await system.patchSync.flush();

    expect(requests).toEqual([[record], [record]]);
    expect(system.patchStore.pendingPatchIds()).toEqual([]);
    expect(system.patchSync.currentState()).toEqual({ status: "in-sync" });
    system.dispose();
  });

  it("is sent again by itself after a while", async () => {
    const { system, refuseAll, setAnswer, edit, retries } = rig();
    refuseAll();
    await edit("later");
    await system.patchSync.flush();
    setAnswer(null);

    expect(retries()).toHaveLength(1);
    retries()[0].wake();
    await settle();
    await system.patchSync.flush();

    expect(system.patchStore.pendingPatchIds()).toEqual([]);
    system.dispose();
  });

  it("runs only the latest refusal's timed retry", async () => {
    const { system, refuseAll, edit, retries, requests } = rig();
    refuseAll();
    await edit("x");
    await system.patchSync.flush();
    system.patchSync.resume();
    await system.patchSync.flush();
    expect(requests).toHaveLength(2);

    // The first refusal's timer is stale: the resume already sent the edit.
    expect(retries()).toHaveLength(2);
    retries()[0].wake();
    await settle();
    expect(requests).toHaveLength(2);
    system.dispose();
  });

  it("does not retry once the sync is disposed", async () => {
    const { system, refuseAll, edit, retries, requests } = rig();
    refuseAll();
    await edit("x");
    await system.patchSync.flush();
    system.dispose();

    retries()[0].wake();
    await settle();
    expect(requests).toHaveLength(1);
  });

  it("is reported again only when the refusal changes, or after a resume", async () => {
    const { system, refuseAll, edit, events, retries } = rig();
    refuseAll();
    await edit("x");
    await system.patchSync.flush();
    expect(events).toHaveLength(1);

    // The timed retry, refused the same way: not news, so a dismissed notice
    // stays dismissed.
    retries()[0].wake();
    await settle();
    await system.patchSync.flush();
    expect(events).toHaveLength(1);

    // Refused for another reason: the trial ended meanwhile.
    refuseAll({
      message: "t's trial has ended, so its Studio is read-only.",
      error: {
        code: "trial-over",
        fix: "add-card",
        until: REFUSAL.error.until,
        billingUrl: REFUSAL.error.billingUrl,
      },
    });
    retries()[1].wake();
    await settle();
    await system.patchSync.flush();
    expect(events).toHaveLength(2);
    expect(system.patchSync.currentState()).toMatchObject({
      status: "refused",
      message: "t's trial has ended, so its Studio is read-only.",
    });

    // The shell said editing opened, and it was refused anyway: news again.
    system.patchSync.resume();
    await system.patchSync.flush();
    expect(events).toHaveLength(3);
    system.dispose();
  });

  it("says a refusal the shell cannot read as a status error, so held edits are never silent", async () => {
    const { system, refuseAll, edit } = rig();
    refuseAll({
      message: "Val Build refused this for a reason this Studio does not know.",
      error: { code: "limit:something-new" },
    });
    await edit("x");
    await system.patchSync.flush();

    const errors = system.status.current().errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].details).toContain(
      "Val Build refused this for a reason this Studio does not know.",
    );
    expect(system.patchStore.pendingPatchIds()).toHaveLength(1);
    system.dispose();
  });

  it("refuses a publish with the plan's reason, not the connection", async () => {
    const { system, refuseAll, edit } = rig();
    refuseAll();
    const record = await edit("held");
    await system.patchSync.flush();

    const res = await system.publish([record]);

    expect(res).toEqual({
      status: "refused",
      reason: "unsaved-changes",
      patchIds: [record],
      planRefusal: REFUSAL.message,
    });
    system.dispose();
  });

  it("tells the shell, with the fix as data", async () => {
    const heard: PlanRefusal[] = [];
    const stop = onPlanRefusal((refusal) => heard.push(refusal));
    const { system, refuseAll, edit } = rig();
    refuseAll();
    await edit("x");
    await system.patchSync.flush();
    stop();

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({
      code: "limit:changes",
      fix: "upgrade",
      until: REFUSAL.error.until,
      billingUrl: REFUSAL.error.billingUrl,
      message: REFUSAL.message,
    });
    system.dispose();
  });

  it("does nothing on resume when nothing is held", async () => {
    const { system, requests } = rig();
    system.patchSync.resume();
    await system.patchSync.flush();
    expect(requests).toEqual([]);
    system.dispose();
  });
});

describe("when a refused save is sent again by itself", () => {
  const now = Date.parse("2026-10-15T12:00:00.000Z");

  it("backs off from a minute, doubling, to at most half an hour", () => {
    expect(refusedRetryMs(undefined, 1, now)).toBe(REFUSED_RETRY_MS);
    expect(refusedRetryMs(undefined, 2, now)).toBe(2 * REFUSED_RETRY_MS);
    expect(refusedRetryMs(undefined, 3, now)).toBe(4 * REFUSED_RETRY_MS);
    expect(refusedRetryMs(undefined, 20, now)).toBe(REFUSED_RETRY_MAX_MS);
  });

  it("waits for the moment the refusal says it lifts", () => {
    expect(refusedRetryMs("2026-10-15T12:10:00.000Z", 5, now)).toBe(
      10 * 60_000 + 1_000,
    );
  });

  it("is never sooner than a minute, nor later than half an hour", () => {
    expect(refusedRetryMs("2026-10-15T12:00:05.000Z", 1, now)).toBe(
      REFUSED_RETRY_MS,
    );
    expect(refusedRetryMs("2026-10-14T12:00:00.000Z", 1, now)).toBe(
      REFUSED_RETRY_MS,
    );
    expect(refusedRetryMs("2026-10-20T12:00:00.000Z", 1, now)).toBe(
      REFUSED_RETRY_MAX_MS,
    );
  });

  it("falls back to the backoff for a time it cannot read", () => {
    expect(refusedRetryMs("soon", 2, now)).toBe(2 * REFUSED_RETRY_MS);
  });
});
