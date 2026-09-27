import type { ValOps } from "@valbuild/server";
import type { PatchId } from "@valbuild/core";
import { deriveParentRef } from "./writePath";

/**
 * What an MCP write names as its parent: the HEAD of the chain.
 *
 * The same rule as the Studio's `PatchSync`, for the same reason. The listing
 * leaves out patches this deployment already contains, and since patch groups a
 * published patch can come after one that is still pending — so the last listed
 * id can be behind the head for good, and a write naming it is refused on its
 * retry too.
 */

// A brand has no constructor, so the sha is cast the way the other server-side
// tests cast theirs.
type BaseSha = Awaited<ReturnType<ValOps["getBaseSha"]>>;
const ops = { getBaseSha: async () => "base-sha" as BaseSha };
const listed = (...ids: string[]) =>
  ids.map((patchId) => ({ patchId: patchId as PatchId }));

test("the reported head wins over the last listed patch", async () => {
  await expect(
    deriveParentRef(ops, {
      patches: listed("pending"),
      headPatchId: "published-after-it" as PatchId,
    }),
  ).resolves.toEqual({ type: "patch", patchId: "published-after-it" });
});

test("a reported empty chain is written on the base, whatever is listed", async () => {
  await expect(
    deriveParentRef(ops, { patches: listed(), headPatchId: null }),
  ).resolves.toEqual({ type: "head", headBaseSha: "base-sha" });
});

test("a store that reports no head falls back to the last listed patch", async () => {
  await expect(
    deriveParentRef(ops, { patches: listed("first", "last") }),
  ).resolves.toEqual({ type: "patch", patchId: "last" });
});

test("and to the base when it lists nothing", async () => {
  await expect(deriveParentRef(ops, { patches: listed() })).resolves.toEqual({
    type: "head",
    headBaseSha: "base-sha",
  });
});
