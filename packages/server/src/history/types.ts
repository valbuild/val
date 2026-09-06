import type { JSONValue } from "@valbuild/core/patch";
import type {
  ModuleFilePath,
  PatchId,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
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

/**
 * A module as one commit left it.
 *
 * Both halves are stored rather than derived. `source` is the module's data,
 * recorded at the commit - not recovered by parsing the `.val.ts` git holds,
 * because that is code and parsing code is best-effort and rots. `schema` is
 * the schema the data was written against, which nothing in the current
 * checkout has once the schema has moved on, and without which the module
 * cannot be RENDERED as it was - only guessed at.
 */
export type HistoricalModule = {
  /** The module's data at this commit. `null` if deleted, or unreadable — see `failures`. */
  source: JSONValue | null;
  /**
   * The schema at this commit, if this version of Val can read it.
   *
   * `null` with a `schema-unreadable` failure means the stored schema is from a
   * Val whose schema format this one does not know. Expected rather than
   * broken, and reported so the Studio can say so kindly.
   */
  schema: SerializedSchema | null;
  patchIds: PatchId[];
  /**
   * What this commit changed here, taken from the ops themselves.
   *
   * The ops ARE the change, so this needs no before-state and no replay - which
   * is what let the static parser and the patch replay go.
   */
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
 * One module's stored version, exactly as the content service returns it.
 *
 * `schema` is `unknown` on purpose: the content service stores it opaquely and
 * cannot vouch for it, so it arrives unvalidated and is checked HERE, where the
 * schema format is actually known. That check is what turns "a project written
 * by a different Val" into a sentence rather than a crash.
 */
export type StoredModuleVersion = {
  moduleFilePath: ModuleFilePath;
  commitSha: string;
  sourceSha: string | null;
  schemaSha: string;
  source: JSONValue | null;
  schema: unknown;
  /** We hold the hash but not the object. Distinct from a deleted module. */
  unavailable: boolean;
};
