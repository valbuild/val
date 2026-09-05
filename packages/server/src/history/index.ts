export type { HistoryError } from "./HistoryError";
export { historyErrorMessage, isWholeCommitError } from "./HistoryError";
export type {
  AffectedFile,
  BinaryFileRef,
  CommitPage,
  CommitPatch,
  FileChange,
  HistoricalCommit,
  HistoricalModule,
  HistoricalPatchSet,
} from "./types";

/**
 * Reading the past. The COMPARISON against the current source is deliberately
 * not here: it depends on source that moves with every keystroke, and both the
 * source and a schema validator already live in the Studio - so doing it here
 * would mean a network round trip per recompute to answer a question the client
 * can answer locally. See packages/ui/spa/history.
 */
export { getHistoricalPatchSet } from "./getHistoricalPatchSet";

export { listCommits } from "./listCommits";
export { fetchCommitRecord } from "./fetchCommitRecord";
export { parseModuleSource } from "./parseModuleSource";
export { applyPatchesToSource } from "./applyPatchesToSource";
export { resolveJsonEntriesAtCommit } from "./resolveJsonEntriesAtCommit";
export {
  describeBinaryFilesAtCommit,
  historyFileUrl,
} from "./describeBinaryFiles";
export { diffSources } from "./diffSources";
