import { z } from "zod";
import { PatchId } from "./Patch";

/**
 * The wire shapes for reading history.
 *
 * Here rather than in `@valbuild/server` because both sides of `/api/val` need
 * them: the server builds these and the Studio parses them, and a second
 * hand-written copy in the client is how the two drift.
 *
 * `HistoryError` is a closed union of everything that can go wrong
 * reconstructing a commit - see `packages/server/src/history/HistoryError.ts`
 * for what each one means. It travels as data rather than as a message because
 * the Studio decides what to OFFER from it: a schema mismatch means "cannot
 * restore this field", a missing source means "cannot restore this module at
 * all", and a rendered string cannot be told apart.
 */
export const HistoryError = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("commit-not-found"), commitSha: z.string() }),
  z.object({
    kind: z.literal("archive-unreadable"),
    commitSha: z.string(),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("source-unavailable"),
    moduleFilePath: z.string(),
  }),
  z.object({
    kind: z.literal("source-unparseable"),
    moduleFilePath: z.string(),
    message: z.string(),
  }),
  z.object({ kind: z.literal("module-removed"), moduleFilePath: z.string() }),
  z.object({
    kind: z.literal("patch-not-applicable"),
    patchId: PatchId,
    moduleFilePath: z.string(),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("schema-mismatch"),
    moduleFilePath: z.string(),
    sourcePath: z.string(),
    errors: z.array(z.object({ message: z.string() }).passthrough()),
  }),
  z.object({
    kind: z.literal("unknown-field"),
    moduleFilePath: z.string(),
    sourcePath: z.string(),
    key: z.string(),
  }),
  z.object({
    kind: z.literal("file-unavailable"),
    gitPath: z.string(),
    message: z.string(),
  }),
  z.object({
    kind: z.literal("unsupported-core-version"),
    patchId: PatchId,
    coreVersion: z.string(),
  }),
  z.object({ kind: z.literal("not-supported-in-fs-mode") }),
  z.object({ kind: z.literal("transport"), message: z.string() }),
]);
export type HistoryError = z.infer<typeof HistoryError>;

export const HistoricalCommit = z.object({
  commitSha: z.string(),
  parentCommitSha: z.string(),
  clientCommitSha: z.string(),
  branch: z.string(),
  createdBranch: z.string().nullable(),
  creator: z.string().nullable(),
  message: z.string().nullable(),
  createdAt: z.string(),
  seqNum: z.string(),
  patchCount: z.number(),
  /** False for commits made before history was recorded. */
  hasArchive: z.boolean(),
});
export type HistoricalCommit = z.infer<typeof HistoricalCommit>;

const FileChange = z.union([
  z.literal("added"),
  z.literal("modified"),
  z.literal("deleted"),
]);

/**
 * A binary file the commit touched - named, with a URL, and nothing fetched.
 * Only an `<img src>` that mounts pays for the bytes.
 */
export const BinaryFileRef = z.object({
  gitPath: z.string(),
  change: FileChange,
  remote: z.boolean(),
  url: z.string(),
});
export type BinaryFileRef = z.infer<typeof BinaryFileRef>;

export const HistoricalModule = z.object({
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  patchIds: z.array(PatchId),
  changedPaths: z.array(z.string()),
  failures: z.array(HistoryError),
});
export type HistoricalModule = z.infer<typeof HistoricalModule>;

export const HistoricalPatchSet = z.object({
  commit: HistoricalCommit,
  modules: z.record(z.string(), HistoricalModule),
  patches: z.array(
    z.object({
      patchId: PatchId,
      moduleFilePath: z.string(),
      patch: z.unknown(),
      authorId: z.string().nullable(),
      createdAt: z.string(),
      baseSha: z.string(),
      coreVersion: z.string(),
    }),
  ),
  jsonEntries: z.record(z.string(), z.unknown()),
  binaryFiles: z.array(BinaryFileRef),
  warnings: z.array(HistoryError),
});
export type HistoricalPatchSet = z.infer<typeof HistoricalPatchSet>;

/**
 * Whether the historical value can be written back as the project stands.
 *
 * Computed in the Studio, not on the server: the verdict depends on the current
 * source and the current schema, both of which the client already holds, and it
 * runs against the same worker-thread validator that validates ordinary edits.
 * The types stay here because they are what a restore preview hands to the UI.
 *
 * `blocked` carries its reasons so a refusal can name the field and say why,
 * rather than being an unexplained disabled button.
 */
export const RestoreVerdict = z.union([
  z.object({ status: z.literal("restorable") }),
  z.object({ status: z.literal("blocked"), reasons: z.array(HistoryError) }),
]);
export type RestoreVerdict = z.infer<typeof RestoreVerdict>;

export const ModuleComparison = z.object({
  current: z.unknown().nullable(),
  /** Paths where the commit's result and the current source differ: what a
   * restore would undo. */
  changedVsCurrent: z.array(z.string()),
  verdict: RestoreVerdict,
});
export type ModuleComparison = z.infer<typeof ModuleComparison>;
