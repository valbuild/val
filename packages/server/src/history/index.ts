export type { HistoryError } from "./HistoryError";
export { historyErrorMessage, isWholeCommitError } from "./HistoryError";
export type {
  AffectedFile,
  BinaryFileRef,
  CommitPage,
  CommitPatch,
  FileChange,
  HistoricalCommit,
  HistoricalComparison,
  HistoricalModule,
  HistoricalPatchSet,
  ModuleComparison,
  RestoreVerdict,
} from "./types";

// The entry point. Everything below it is exported for callers that want one
// step on its own - warming a cache, or checking a narrower selection.
export { getHistoricalComparison } from "./getHistoricalComparison";

export { listCommits } from "./listCommits";
export { fetchCommitRecord } from "./fetchCommitRecord";
export { parseModuleSource } from "./parseModuleSource";
export { applyPatchesToSource } from "./applyPatchesToSource";
export { resolveJsonEntriesAtCommit } from "./resolveJsonEntriesAtCommit";
export {
  describeBinaryFilesAtCommit,
  historyFileUrl,
} from "./describeBinaryFiles";
export { validateAgainstCurrentSchema } from "./validateAgainstCurrentSchema";
export { diffSources } from "./diffSources";
export { buildRestoreVerdict } from "./restorability";
export { getHistoricalPatchSet } from "./getHistoricalPatchSet";
export { compareWithCurrent } from "./compareWithCurrent";
