import { result } from "@valbuild/core/fp";
import type { ValOps } from "../ValOps";
import type { HistoryError } from "./HistoryError";
import type {
  AffectedFile,
  CommitPatch,
  HistoricalCommit,
  StoredModuleVersion,
} from "./types";

export type CommitRecord = {
  commit: HistoricalCommit;
  patches: CommitPatch[];
  /** Each module this commit changed, as data plus the schema it was under. */
  modules: StoredModuleVersion[];
  affectedFiles: AffectedFile[];
};

/**
 * Everything the content service knows about one commit, in one step.
 *
 * Three endpoints, requested together rather than in sequence: they are
 * independent, they all resolve from the same stored record, and the round
 * trips are what a user waits through when opening a commit.
 *
 * The commit itself comes from the patches call, which is the one that fails
 * usefully when the commit does not exist.
 */
export async function fetchCommitRecord(
  ops: ValOps,
  commitSha: string,
): Promise<result.Result<CommitRecord, HistoryError>> {
  const [patchesRes, modulesRes, filesRes] = await Promise.all([
    ops.getCommitPatches(commitSha),
    ops.getCommitModules(commitSha),
    ops.getCommitAffectedFiles(commitSha),
  ]);
  if (result.isErr(patchesRes)) {
    return patchesRes;
  }
  if (result.isErr(modulesRes)) {
    return modulesRes;
  }
  if (result.isErr(filesRes)) {
    return filesRes;
  }
  return result.ok({
    commit: patchesRes.value.commit,
    patches: patchesRes.value.patches,
    modules: modulesRes.value,
    affectedFiles: filesRes.value,
  });
}
