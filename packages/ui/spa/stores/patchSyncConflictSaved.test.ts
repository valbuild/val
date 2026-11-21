import { initVal, type PatchId } from "@valbuild/core";
import { createSystem } from "./createSystem";
import type { SaveResult } from "./PatchSync";
import { mfp } from "./testSystem";

/**
 * A batch the server took PART of before it conflicted.
 *
 * Each patch in a `PUT /patches` is its own write on the content service, so
 * another writer's patch can land between two of ours: the first is saved,
 * the second names a parent that is no longer the head, and the answer is a
 * 409. The 409 used to say nothing about the first, so the sync still held it
 * as unsaved and sent it again -- and the content service refuses a patch id
 * it already has, so the retry failed on it forever and the edit after it was
 * never saved. The 409 now names what was saved, as the 502 and 403 do.
 */
const module = () => {
  const { c, s } = initVal();
  return c.define(
    "/t.val.ts",
    s.object({ title: s.string(), body: s.string() }),
    { title: "Hello", body: "World" },
  );
};

function rig(firstAnswer: (ids: PatchId[]) => SaveResult) {
  const requests: PatchId[][] = [];
  let first = true;
  const system = createSystem({
    fetchPatches: async () => ({ patches: [] }),
    createPatchId: (() => {
      let next = 0;
      return () => `p-${++next}` as PatchId;
    })(),
    savePatches: async ({ patches }) => {
      const ids = patches.map((entry) => entry.patchId);
      requests.push(ids);
      if (first) {
        first = false;
        return firstAnswer(ids);
      }
      return {
        status: "saved",
        newPatchIds: ids,
        parentRef: { type: "patch", patchId: ids[ids.length - 1] },
      };
    },
    publishPatches: async () => ({ status: "published" }),
    saveBackoffMs: () => 0,
    saveSleep: () => Promise.resolve(),
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
  return { system, requests, edit };
}

/** Let the write loop's own promises run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a conflict after part of a batch was saved", () => {
  it("does not send the saved part again", async () => {
    const takes = "p-1" as PatchId;
    const { system, requests, edit } = rig((ids) => ({
      status: "conflict",
      message: "Conflict",
      saved: {
        newPatchIds: ids.filter((id) => id === takes),
        parentRef: { type: "patch", patchId: takes },
        headVersion: 1,
      },
    }));
    // Two edits before the first save goes, so they travel as one batch.
    const one = await edit("one");
    const two = await edit("two");
    expect(one).toBe(takes);
    await system.patchSync.flush();
    await settle();
    await system.patchSync.flush();

    expect(requests[0]).toEqual([one, two]);
    // Only what the conflict did not take is sent again.
    expect(requests.slice(1)).toEqual([[two]]);
    expect(system.patchStore.isPending(one)).toBe(false);
    expect(system.patchStore.isPending(two)).toBe(false);
  });

  it("sends the whole batch again when the server says nothing was saved", async () => {
    // A server from before the 409 carried this, and a conflict on the
    // batch's first patch: nothing was written, so everything goes again.
    const { system, requests, edit } = rig(() => ({
      status: "conflict",
      message: "Conflict",
    }));
    const one = await edit("one");
    const two = await edit("two");
    await system.patchSync.flush();
    await settle();
    await system.patchSync.flush();

    expect(requests).toEqual([
      [one, two],
      [one, two],
    ]);
    expect(system.patchStore.isPending(one)).toBe(false);
    expect(system.patchStore.isPending(two)).toBe(false);
  });
});
