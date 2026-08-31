import { result } from "@valbuild/core/fp";
import type { ValOps } from "../ValOps";
import type { HistoryError } from "./HistoryError";
import type { HistoricalComparison } from "./types";
import { getHistoricalPatchSet } from "./getHistoricalPatchSet";
import { compareWithCurrent } from "./compareWithCurrent";

/**
 * THE entry point: everything about one commit, measured against today.
 *
 * Given a commit sha, produce how each module looked before it, how the commit
 * left it, how that compares to the source right now, and whether it could be
 * put back into the schema as it stands.
 *
 * Two functions underneath, and the split is the caching story rather than
 * decomposition for its own sake: `getHistoricalPatchSet` cannot change for a
 * given sha, so it is cached forever, while `compareWithCurrent` depends on
 * source that moves with every keystroke. A caller warming a cache calls the
 * first directly; a caller answering "what would restoring this do" calls this.
 */
export async function getHistoricalComparison(
  ops: ValOps,
  commitSha: string,
  options?: { apiBasePath?: string },
): Promise<result.Result<HistoricalComparison, HistoryError>> {
  const patchSetRes = await getHistoricalPatchSet(ops, commitSha, options);
  if (result.isErr(patchSetRes)) {
    return patchSetRes;
  }
  return compareWithCurrent(ops, patchSetRes.value);
}
