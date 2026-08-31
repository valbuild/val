import type { JSONValue } from "@valbuild/core/patch";
import type { ModuleFilePath, PatchId, SourcePath } from "@valbuild/core";
import type { HistoryError } from "./HistoryError";

/** One commit, as history lists it. */
export type HistoricalCommit = {
  commitSha: string;
  parentCommitSha: string;
  clientCommitSha: string;
  branch: string;
  createdBranch: string | null;
  creator: string | null;
  message: string | null;
  createdAt: string;
  seqNum: string;
  patchCount: number;
  /**
   * Whether this commit's record was stored. False for commits made before
   * history was recorded: their patches are still readable, but not the
   * pre-commit sources a restore replays against.
   */
  hasArchive: boolean;
};

export type CommitPage = {
  commits: HistoricalCommit[];
  /** Pass as `cursor` for the next page. `null` when there are no more. */
  nextCursor: string | null;
};

export type CommitPatch = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  patch: unknown;
  authorId: string | null;
  createdAt: string;
  baseSha: string;
  coreVersion: string;
};

export type FileChange = "added" | "modified" | "deleted";

export type AffectedFile =
  | {
      kind: "module-source" | "json-entry" | "binary";
      gitPath: string;
      change: FileChange;
    }
  | { kind: "remote-binary"; ref: string; change: FileChange };

/**
 * A binary file this commit touched - named, not fetched.
 *
 * `url` is where the bytes are IF something needs them. Nothing downloads a
 * commit's images to show that the commit changed them; the descriptor is
 * enough to render a row, and only an `<img src>` that actually mounts pays.
 */
export type BinaryFileRef = {
  gitPath: string;
  change: FileChange;
  remote: boolean;
  url: string;
};

/** What one module looked like before a commit, and after it. */
export type HistoricalModule = {
  /** Source before the commit. `null` when it could not be read - see `failures`. */
  before: JSONValue | null;
  /** `before` with this commit's patches replayed. `null` if `before` is. */
  after: JSONValue | null;
  patchIds: PatchId[];
  /** Paths where `before` and `after` differ: what this commit changed here. */
  changedPaths: SourcePath[];
  /** Per-module problems. Collected, never thrown - see HistoryError. */
  failures: HistoryError[];
};

/**
 * A commit, reconstructed.
 *
 * Deliberately says nothing about the CURRENT source or schema, so it can never
 * change for a given commit sha - which is what lets it be cached forever. The
 * comparison against today lives in `HistoricalComparison`.
 */
export type HistoricalPatchSet = {
  commit: HistoricalCommit;
  modules: Record<ModuleFilePath, HistoricalModule>;
  patches: CommitPatch[];
  /** `*.val.json` entry contents at this commit, keyed by git path. */
  jsonEntries: Record<string, JSONValue>;
  binaryFiles: BinaryFileRef[];
  /** Problems that are about the commit but did not stop it being read. */
  warnings: HistoryError[];
};

/**
 * Whether the historical value can be written back into the project as it is
 * today.
 *
 * Per patch set rather than per module: a patch set is the smallest thing a UI
 * offers to restore, so it is the smallest thing worth blocking. The reasons
 * are kept so a refusal can say which field and why, rather than just "no".
 */
export type RestoreVerdict =
  | { status: "restorable" }
  | { status: "blocked"; reasons: HistoryError[] };

export type ModuleComparison = {
  /** The module's source right now. `null` if it no longer exists. */
  current: JSONValue | null;
  /** Paths where `after` and `current` differ: what a restore would undo. */
  changedVsCurrent: SourcePath[];
  verdict: RestoreVerdict;
};

/** A reconstructed commit, measured against the project as it is now. */
export type HistoricalComparison = {
  patchSet: HistoricalPatchSet;
  modules: Record<ModuleFilePath, ModuleComparison>;
};
