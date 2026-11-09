import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { PatchStore } from "./PatchStore";

/**
 * What the patch store keeps per patch goes when the patch does: a long
 * session publishes and discards thousands of edits, and a map that only
 * grows is a tab that only grows. `heldSince` -- when this Studio started
 * holding a patch as the server's -- was the one left out.
 */
const MODULE = "/home.val.ts" as ModuleFilePath;

async function savedPatch(store: PatchStore): Promise<PatchId> {
  const created = await store.createPatch(MODULE, [
    { op: "replace", path: ["title"], value: "Hi" },
  ]);
  if (created.status !== "created") throw new Error("not created");
  store.markSaved([created.record.patchId]);
  return created.record.patchId;
}

test("a published patch is no longer held, and a manifest says nothing of it", async () => {
  const store = new PatchStore(async () => ({ patches: [] }));
  const patchId = await savedPatch(store);
  const later = store.nextManifestEpoch();
  expect(store.decidedGone(patchId, later)).toBe(true);

  store.forgetPublished([patchId]);

  expect(store.decidedGone(patchId, store.nextManifestEpoch())).toBe(false);
});

test("a dropped patch is no longer held either", async () => {
  const store = new PatchStore(async () => ({ patches: [] }));
  const patchId = await savedPatch(store);

  store.drop([patchId]);

  expect(store.decidedGone(patchId, store.nextManifestEpoch())).toBe(false);
});
