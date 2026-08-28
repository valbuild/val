import { ModuleFilePath, PatchId } from "@valbuild/core";
import { Patch } from "@valbuild/shared/internal";
import fs from "fs";
import fsPath from "path";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import type { AuthorId, BaseSha } from "./ValOps";
import {
  appendPatchLogEntry,
  PATCH_LOG_FILE_NAME,
  PatchLogEntry,
  PatchLogProblem,
  readPatchLog,
  writePatchLogFile,
} from "./patchLog";

/**
 * The on-disk shape of the local-dev patch store.
 *
 * ```
 * .val/patches/
 *   patches.log            the order, and the only place it lives
 *   patches.repair.log     what repair has done, for the person who has to know
 *   <patchId>/patch.json   one plain, self-contained directory per patch
 *   <patchId>/base.json    written when the patch is published
 *   <patchId>/files/…      binary payloads for this patch's file ops
 * ```
 *
 * A directory is named after the patch it holds, and a record references nothing
 * outside itself. That is the whole design, and it is a direct answer to how the
 * old layout failed: there, a directory was named after a record's PARENT, so
 * reading the store meant following links, and one absent record silently cut off
 * every patch written after it.
 *
 * The invariant this module exists to hold up is narrow and worth stating: **the
 * announced set and the delivered set are the same array.** `getStat` and
 * `fetchPatches` both come out of one `readPatchStore` call, so they cannot report
 * different numbers - which is exactly what they did when this broke, announcing
 * 410 patches and delivering 359 with no error in between.
 */

export const PATCH_REPAIR_LOG_FILE_NAME = "patches.repair.log";

export const FSPatch = z.object({
  path: z
    .string()
    .refine(
      (p): p is ModuleFilePath => p.startsWith("/") && p.includes(".val."),
      "Path is not valid. Must start with '/' and include '.val.'",
    ),
  patch: Patch,
  patchId: z.string(),
  baseSha: z.string().refine((_p): _p is BaseSha => true),
  authorId: z
    .string()
    .refine((_p): _p is AuthorId => true)
    .nullable(),
  createdAt: z.string().datetime(),
  coreVersion: z.string().nullable(),
  sessionId: z.string().nullable(),
});
export type FSPatchRecord = z.infer<typeof FSPatch>;

export const FSPatchBase = z.object({
  baseSha: z.string().refine((_p): _p is BaseSha => true),
  timestamp: z.string().datetime(),
});
export type FSPatchBaseRecord = z.infer<typeof FSPatchBase>;

export type PatchStoreEntry = {
  patchId: PatchId;
  record: FSPatchRecord;
  /** Present once the patch has been published. */
  base: FSPatchBaseRecord | null;
};

/**
 * Something wrong with the store that a reader can see.
 *
 * Every one of these used to be invisible. Reporting them is the point: the
 * failure that motivated this rewrite was not that the store broke, it was that
 * breaking looked exactly like working.
 */
export type PatchStoreProblem =
  | { type: "log"; problem: PatchLogProblem }
  /**
   * A directory that cannot be used as a patch: no record, a record that does
   * not parse, or one whose `patchId` is not the directory it sits in.
   *
   * That last case is what a store from before this layout looks like - its
   * directories are named after each record's PARENT - and it is deliberately
   * not special-cased. There is nothing to recover: the order lived in links
   * that are exactly what goes wrong, so an old store is read as a pile of
   * unusable directories and removed like any other.
   *
   * This is the problem the person editing is told about, because it is the one
   * where unpublished work disappears.
   */
  | {
      type: "unreadable-patch";
      /** The directory name, which for a usable patch IS the patch id. */
      name: string;
      dir: string;
      message: string;
    }
  /**
   * A perfectly good record the log does not name.
   *
   * The benign half of a crash: a record is written before its log line, so an
   * interrupted append leaves this behind. Nothing ever read it, so nothing is
   * lost by sweeping it up, and the person editing does not need to hear about
   * a patch that never existed as far as they were concerned.
   */
  | { type: "orphan-directory"; name: string; dir: string }
  /**
   * The log was gone, and the order was recovered from the records' timestamps.
   *
   * Reported because it is a guess. Patches written inside the same millisecond
   * have no recoverable order - a real store had eight inside 20ms.
   */
  | { type: "reconstructed-log"; entryCount: number };

export type ReadPatchStoreResult =
  | { status: "ok"; entries: PatchStoreEntry[]; problems: PatchStoreProblem[] }
  | { status: "unreadable"; message: string };

export function patchesLogFile(patchesDir: string): string {
  return fsPath.join(patchesDir, PATCH_LOG_FILE_NAME);
}

export function patchRepairLogFile(patchesDir: string): string {
  return fsPath.join(patchesDir, PATCH_REPAIR_LOG_FILE_NAME);
}

export function patchDir(patchesDir: string, patchId: PatchId): string {
  return fsPath.join(patchesDir, patchId);
}

export function patchRecordFile(patchesDir: string, patchId: PatchId): string {
  return fsPath.join(patchDir(patchesDir, patchId), "patch.json");
}

export function patchBaseFile(patchesDir: string, patchId: PatchId): string {
  return fsPath.join(patchDir(patchesDir, patchId), "base.json");
}

/**
 * Where a patch's uploaded bytes wait for the record that will reference them.
 *
 * ## Why they cannot simply be written into the patch directory
 *
 * A patch that carries a file is written in TWO requests, and the bytes go
 * first: the record's `file` op holds only a sha, so a record written before its
 * bytes would point at nothing. Uploading straight into `<patchId>/files/` left
 * the directory holding files and no `patch.json` for the length of a round
 * trip — which is neither of the two shapes this store allows, so
 * {@link readPatchStore} read it as a patch whose contents were lost and repair
 * removed it, bytes and all.
 *
 * And that window is not passive: writing into the patches directory is exactly
 * what ends `getStat`'s long poll, so the upload summoned the read that
 * destroyed it. Replacing an image worked only when the two requests happened to
 * land close enough together.
 *
 * So the bytes are not in the store until they belong to something.
 * {@link appendPatch} moves them in after writing the record, under the lock, so
 * no reader ever sees a half-built patch directory — and the invariant that a
 * directory either holds a usable record or is named by the log holds again,
 * with nothing to tolerate and no ambiguous state to classify.
 *
 * A SIBLING of the patches directory, for two reasons: nothing that reads the
 * store lists it, and it is on the same filesystem, so moving into place is a
 * rename rather than a copy.
 */
export function uploadsDir(patchesDir: string): string {
  return fsPath.join(fsPath.dirname(patchesDir), "uploads");
}

/** Where one patch's uploads wait. See {@link uploadsDir}. */
export function patchUploadDir(patchesDir: string, patchId: PatchId): string {
  return fsPath.join(uploadsDir(patchesDir), patchId);
}

/**
 * The binary layout, relative to whichever directory holds it.
 *
 * Shared by the patch directory and the staging directory so the two cannot
 * drift — a move into place has to land the bytes exactly where a read expects
 * them.
 */
function binaryFilesDir(dir: string): string {
  return fsPath.join(dir, "files");
}

function binaryFileIn(dir: string, filePath: string): string {
  return fsPath.join(binaryFilesDir(dir), filePath, fsPath.basename(filePath));
}

function binaryFileMetadataIn(dir: string, filePath: string): string {
  return fsPath.join(binaryFilesDir(dir), filePath, "metadata.json");
}

export function patchBinaryFile(
  patchesDir: string,
  patchId: PatchId,
  filePath: string,
): string {
  return binaryFileIn(patchDir(patchesDir, patchId), filePath);
}

export function patchBinaryFileMetadata(
  patchesDir: string,
  patchId: PatchId,
  filePath: string,
): string {
  return binaryFileMetadataIn(patchDir(patchesDir, patchId), filePath);
}

/** The staged twin of {@link patchBinaryFile}. */
export function stagedPatchBinaryFile(
  patchesDir: string,
  patchId: PatchId,
  filePath: string,
): string {
  return binaryFileIn(patchUploadDir(patchesDir, patchId), filePath);
}

/** The staged twin of {@link patchBinaryFileMetadata}. */
export function stagedPatchBinaryFileMetadata(
  patchesDir: string,
  patchId: PatchId,
  filePath: string,
): string {
  return binaryFileMetadataIn(patchUploadDir(patchesDir, patchId), filePath);
}

/**
 * Move a patch's staged uploads into the patch directory.
 *
 * Called by {@link appendPatch} between the record and the log line, so it runs
 * under the lock and no reader can observe the halfway state.
 *
 * The whole `files` tree in one rename where it can be — the common case, since
 * a patch's files only ever arrive before its record — and per file otherwise,
 * for the case where something is already there.
 */
function moveStagedUploadsIn(patchesDir: string, patchId: PatchId): void {
  const from = binaryFilesDir(patchUploadDir(patchesDir, patchId));
  if (!fs.existsSync(from)) {
    return;
  }
  const to = binaryFilesDir(patchDir(patchesDir, patchId));
  if (!fs.existsSync(to)) {
    fs.mkdirSync(fsPath.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  } else {
    moveTreeInto(from, to);
  }
  removeStagedUploads(patchesDir, patchId);
}

/** File-by-file, for when the destination already holds some of the tree. */
function moveTreeInto(from: string, to: string): void {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = fsPath.join(from, entry.name);
    const target = fsPath.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      moveTreeInto(source, target);
      continue;
    }
    fs.mkdirSync(fsPath.dirname(target), { recursive: true });
    fs.renameSync(source, target);
  }
}

/** Drop a patch's staging directory, whatever is left of it. */
export function removeStagedUploads(
  patchesDir: string,
  patchId: PatchId,
): void {
  try {
    fs.rmSync(patchUploadDir(patchesDir, patchId), {
      recursive: true,
      force: true,
    });
  } catch {
    // Hygiene, not correctness: nothing reads a staging directory that no patch
    // claims, and the sweep below gets it eventually.
  }
}

/**
 * How long an upload nobody claimed is kept.
 *
 * Only garbage collection, which is why it can be a guess at all: these bytes
 * are outside the store, so no reader can mistake them for a patch and nothing
 * is lost by keeping them a while. The old marker-based attempt at this problem
 * had a TTL deciding whether to delete something INSIDE the store, where being
 * wrong meant destroying a live upload.
 */
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

/**
 * Drop staged uploads whose patch never arrived.
 *
 * A client that dies between the upload and the `PUT` leaves its bytes here.
 * Nothing references them — no record points at them and the log never named
 * them — so they are removed without a word.
 */
export function sweepStaleUploads(
  patchesDir: string,
  now: number = Date.now(),
): void {
  const dir = uploadsDir(patchesDir);
  if (!fs.existsSync(dir)) {
    return;
  }
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const staged = fsPath.join(dir, name);
    try {
      if (now - fs.statSync(staged).mtimeMs < STALE_UPLOAD_MS) continue;
      fs.rmSync(staged, { recursive: true, force: true });
    } catch {
      // Someone else is writing here, or it is already gone. Either way it is
      // not this pass's business.
    }
  }
}

/** Names that live in the patches directory but are not patches. */
const RESERVED_NAMES = new Set([
  PATCH_LOG_FILE_NAME,
  PATCH_REPAIR_LOG_FILE_NAME,
]);

function readJsonFile<T>(
  filePath: string,
  parser: z.ZodType<T>,
): { data: T; error?: undefined } | { error: string; data?: undefined } {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
  if (raw === "") {
    return { error: "the file is empty" };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return {
      error: `it is not valid JSON: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }
  const parsed = parser.safeParse(json);
  if (!parsed.success) {
    return { error: fromError(parsed.error).toString() };
  }
  return { data: parsed.data };
}

function listPatchDirNames(patchesDir: string): string[] {
  return fs
    .readdirSync(patchesDir, { withFileTypes: true })
    .filter(
      (dirent) => dirent.isDirectory() && !RESERVED_NAMES.has(dirent.name),
    )
    .map((dirent) => dirent.name);
}

/**
 * Read the whole store: the order, the records, and everything wrong with it.
 *
 * One call, one answer. Callers that need only the ids and callers that need the
 * ops both use this, which is what stops them disagreeing.
 */
export function readPatchStore(patchesDir: string): ReadPatchStoreResult {
  if (!fs.existsSync(patchesDir)) {
    return { status: "ok", entries: [], problems: [] };
  }

  let dirNames: string[];
  try {
    dirNames = listPatchDirNames(patchesDir);
  } catch (err) {
    return {
      status: "unreadable",
      message: `Could not list ${patchesDir}: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }

  const problems: PatchStoreProblem[] = [];
  const logRes = readPatchLog(patchesLogFile(patchesDir));
  if (logRes.status === "unreadable") {
    return { status: "unreadable", message: logRes.message };
  }

  let logEntries: PatchLogEntry[];
  if (logRes.status === "absent") {
    if (dirNames.length === 0) {
      return { status: "ok", entries: [], problems: [] };
    }
    logEntries = reconstructLogEntries(patchesDir, dirNames);
    if (logEntries.length > 0) {
      problems.push({
        type: "reconstructed-log",
        entryCount: logEntries.length,
      });
    }
  } else {
    logEntries = logRes.entries;
    for (const problem of logRes.problems) {
      problems.push({ type: "log", problem });
    }
  }

  const entries: PatchStoreEntry[] = [];
  const named = new Set<string>();
  for (const logEntry of logEntries) {
    named.add(logEntry.patchId);
    const read = readPatchRecord(patchesDir, logEntry.patchId);
    if (read.error !== undefined) {
      problems.push({
        type: "unreadable-patch",
        name: logEntry.patchId,
        dir: patchDir(patchesDir, logEntry.patchId),
        message: read.error,
      });
      continue;
    }
    const baseFile = patchBaseFile(patchesDir, logEntry.patchId);
    const baseRes = fs.existsSync(baseFile)
      ? readJsonFile(baseFile, FSPatchBase)
      : undefined;
    entries.push({
      patchId: logEntry.patchId,
      record: read.data,
      base: baseRes?.data ?? null,
    });
  }

  for (const name of dirNames) {
    if (named.has(name)) {
      continue;
    }
    // Told apart by whether the directory holds a usable record. One is a patch
    // whose contents are lost and has to be reported; the other is a crash
    // leftover nothing ever read.
    const read = readPatchRecord(patchesDir, name);
    if (read.error !== undefined) {
      problems.push({
        type: "unreadable-patch",
        name,
        dir: fsPath.join(patchesDir, name),
        message: read.error,
      });
    } else {
      problems.push({
        type: "orphan-directory",
        name,
        dir: fsPath.join(patchesDir, name),
      });
    }
  }

  return { status: "ok", entries, problems };
}

/**
 * Read one patch directory, insisting it holds the patch it is named after.
 *
 * The name check is not a formality. A directory named after something other
 * than the record inside is how the previous layout worked - the name was the
 * record's PARENT - so this is what tells a store this version can use from one
 * it cannot.
 */
function readPatchRecord(
  patchesDir: string,
  name: string,
): { data: FSPatchRecord; error?: undefined } | { error: string } {
  const file = patchRecordFile(patchesDir, name as PatchId);
  if (!fs.existsSync(file)) {
    return { error: `there is no ${file}` };
  }
  const res = readJsonFile(file, FSPatch);
  if (res.error !== undefined) {
    return { error: res.error };
  }
  if (res.data.patchId !== name) {
    return {
      error: `it holds ${res.data.patchId}, not the patch its directory is named after`,
    };
  }
  return { data: res.data };
}

/**
 * Rebuild the order from the records when the log itself is gone.
 *
 * `createdAt` is the only ordering left, and it is not a perfect one, so the
 * caller reports that the order was guessed rather than presenting it as fact.
 */
function reconstructLogEntries(
  patchesDir: string,
  dirNames: string[],
): PatchLogEntry[] {
  const entries: PatchLogEntry[] = [];
  for (const name of dirNames) {
    const res = readJsonFile(
      fsPath.join(patchesDir, name, "patch.json"),
      FSPatch,
    );
    if (res.error !== undefined || res.data.patchId !== name) {
      continue;
    }
    entries.push({
      patchId: res.data.patchId as PatchId,
      createdAt: res.data.createdAt,
      path: res.data.path,
    });
  }
  entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return entries;
}

/** Write a patch record so that a reader sees all of it or none of it. */
export function writePatchRecord(
  patchesDir: string,
  patchId: PatchId,
  record: FSPatchRecord,
): void {
  const dir = patchDir(patchesDir, patchId);
  fs.mkdirSync(dir, { recursive: true });
  const file = patchRecordFile(patchesDir, patchId);
  const tmpFile = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmpFile, "w");
  try {
    fs.writeSync(fd, JSON.stringify(record));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpFile, file);
}

/**
 * Add a patch to the store.
 *
 * Record first, then the log line, and the order is the safety property: an
 * interrupted append leaves a directory nothing points at, which repair sweeps
 * up. The reverse order would leave the log naming a patch that is not there -
 * the exact state this whole rewrite exists to make unreachable.
 *
 * Callers must hold the patch lock.
 */
export function appendPatch(
  patchesDir: string,
  record: FSPatchRecord,
): PatchLogEntry {
  const patchId = record.patchId as PatchId;
  writePatchRecord(patchesDir, patchId, record);
  /*
   * Then the bytes, then the log line — and the order is the whole point.
   *
   * The record goes first, so the directory never exists without one: that is
   * what makes "files but no patch.json" a state this store cannot produce, and
   * what lets a reader keep treating it as a patch whose contents are lost.
   * The log line goes last, so an interrupted append leaves a directory the log
   * does not name — the benign half of a crash, swept silently.
   *
   * See `uploadsDir`. Under the lock, like the rest of this function.
   */
  moveStagedUploadsIn(patchesDir, patchId);
  const entry: PatchLogEntry = {
    patchId,
    createdAt: record.createdAt,
    path: record.path,
  };
  appendPatchLogEntry(patchesLogFile(patchesDir), entry);
  return entry;
}

export type RepairAction =
  | {
      type: "removed-unreadable-patch";
      name: string;
      because: string;
    }
  | { type: "removed-orphan-directory"; name: string }
  | { type: "rewrote-log"; entryCount: number };

/**
 * Bring the store back to a state where the log and the directories agree.
 *
 * Safe in a way the old layout's repair could never be: the log is a flat list,
 * so dropping an entry does not orphan the entries after it. There is nothing to
 * re-link, which is why this can run unattended where re-parenting a chain could
 * not.
 *
 * A patch that cannot be read is removed rather than kept around to fail again
 * on every load. That does discard unpublished work, which is why
 * {@link RepairAction} carries the reason, why it is written to
 * `patches.repair.log`, and why the caller is expected to tell the person
 * editing.
 *
 * Callers must hold the patch lock.
 */
export function repairPatchStore(
  patchesDir: string,
  read: Extract<ReadPatchStoreResult, { status: "ok" }>,
): RepairAction[] {
  const actions: RepairAction[] = [];
  const needsRewrite = read.problems.some(
    (problem) =>
      problem.type === "unreadable-patch" ||
      problem.type === "reconstructed-log" ||
      problem.type === "log",
  );

  for (const problem of read.problems) {
    if (problem.type === "unreadable-patch") {
      remove(problem.dir);
      actions.push({
        type: "removed-unreadable-patch",
        name: problem.name,
        because: problem.message,
      });
    } else if (problem.type === "orphan-directory") {
      remove(problem.dir);
      actions.push({ type: "removed-orphan-directory", name: problem.name });
    }
  }

  if (needsRewrite) {
    writePatchLogFile(
      patchesLogFile(patchesDir),
      read.entries.map((entry) => ({
        patchId: entry.patchId,
        createdAt: entry.record.createdAt,
        path: entry.record.path,
      })),
    );
    actions.push({ type: "rewrote-log", entryCount: read.entries.length });
  }

  if (actions.length > 0) {
    recordRepair(patchesDir, actions);
  }
  return actions;
}

function remove(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Left in place. It is inert either way - nothing reads a directory the log
    // does not name, and the log has already been rewritten without it.
  }
}

/**
 * Leave a trail. Repair drops a person's unpublished edits, and doing that
 * without saying so anywhere durable is how you get someone certain they saved
 * something and no way to tell them what happened to it.
 */
function recordRepair(patchesDir: string, actions: RepairAction[]): void {
  const at = new Date().toISOString();
  const lines = actions.map((action) => {
    if (action.type === "removed-unreadable-patch") {
      return `${at} removed ${action.name}: ${action.because}`;
    }
    if (action.type === "removed-orphan-directory") {
      return `${at} removed orphan directory ${action.name}`;
    }
    return `${at} rewrote the log with ${action.entryCount} entries`;
  });
  try {
    fs.appendFileSync(
      patchRepairLogFile(patchesDir),
      `${lines.join("\n")}\n`,
      "utf-8",
    );
  } catch {
    // An audit trail that cannot be written is not a reason to fail the repair.
  }
}

/**
 * Last resort: move the whole store aside and start empty.
 *
 * A rename, never a delete. What is being given up on here is someone's
 * unpublished work, and the least this can do is say where it went.
 *
 * Callers must hold the patch lock.
 */
export function resetPatchStore(
  patchesDir: string,
  reason: string,
): { movedTo: string } | { error: string } {
  if (!fs.existsSync(patchesDir)) {
    return { movedTo: patchesDir };
  }
  const movedTo = `${patchesDir}-corrupt-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  try {
    fs.renameSync(patchesDir, movedTo);
  } catch (err) {
    return {
      error: `Could not move ${patchesDir} aside: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }
  try {
    fs.mkdirSync(patchesDir, { recursive: true });
    fs.appendFileSync(
      patchRepairLogFile(patchesDir),
      `${new Date().toISOString()} reset the store (${reason}); the previous contents are in ${movedTo}\n`,
      "utf-8",
    );
  } catch {
    // The rename is the part that mattered.
  }
  return { movedTo };
}

/** One line per problem, for a log line or an API error a person has to act on. */
export function describePatchStoreProblems(
  problems: readonly PatchStoreProblem[],
): string[] {
  return problems.map((problem) => {
    switch (problem.type) {
      case "unreadable-patch":
        return `The change ${problem.name} could not be read: ${problem.message} (${problem.dir})`;
      case "orphan-directory":
        return `${problem.dir} is not listed in the log and is not being used.`;
      case "reconstructed-log":
        return `The log was missing, so the order of ${problem.entryCount} change(s) was reconstructed from their timestamps and may not be exact.`;
      case "log":
        return describeLogProblem(problem.problem);
    }
  });
}

function describeLogProblem(problem: PatchLogProblem): string {
  switch (problem.type) {
    case "missing-header":
      return `The log does not start with its header (it starts with ${JSON.stringify(problem.firstLine)}).`;
    case "unsupported-version":
      return `The log says ${JSON.stringify(problem.header)}, which this version of Val does not understand.`;
    case "unparseable-line":
      return `Line ${problem.lineNumber} of the log could not be read: ${JSON.stringify(problem.line)}`;
    case "duplicate-entry":
      return `The change ${problem.patchId} is listed twice in the log (line ${problem.lineNumber}).`;
    case "torn-final-line":
      return `The last line of the log was not finished being written and was ignored.`;
  }
}
