import type { PatchId } from "@valbuild/core";

/**
 * The patch a new write names as its parent: the HEAD of the chain, or `null`
 * when the chain is empty and the write goes on the base.
 *
 * The head the server REPORTS (`headPatchId`) when it reports one, and not the
 * last patch it listed. The list — `/applicable/patches`, and `/stat` on top of
 * it — leaves out patches the running deployment already contains, and since
 * patch groups a publish can ship later patches while an earlier one stays
 * pending (another author's change that nets to nothing can never be published
 * at all). The last listed id is then behind the head for good, and the content
 * service accepts a write only on the head, so every save naming it is refused
 * — and a re-sync returns the same list. What fixed it in the Studio before
 * this existed was discarding the other author's change.
 *
 * `null` is a REPORTED empty chain, not "unknown". `undefined` is a server
 * that reports no head (`fs` mode, which ignores the parent anyway, or a
 * content service that predates the field), and only then does this fall back
 * to the last listed id.
 *
 * One rule for both writers, the Studio's `PatchSync` and the MCP's
 * `deriveParentRef`, so they cannot come to name different parents.
 */
export function chainHeadOf(
  reportedHead: PatchId | null | undefined,
  listed: readonly PatchId[],
): PatchId | null {
  if (reportedHead !== undefined) {
    return reportedHead;
  }
  return listed[listed.length - 1] ?? null;
}
