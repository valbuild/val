import { ModuleFilePath, PatchId } from "@valbuild/core";
import { Patch } from "@valbuild/shared/internal";
import fs from "fs";
import fsPath from "path";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import type { AuthorId } from "./ValOps";
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
  baseSha: z.string(),
  authorId: z
    .string()
    .refine((p): p is AuthorId => true)
    .nullable(),
  createdAt: z.string().datetime(),
  coreVersion: z.string().nullable(),
  sessionId: z.string().nullable(),
});
export type FSPatchRecord = z.infer<typeof FSPatch>;

export const FSPatchBase = z.object({
  baseSha: z.string(),
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
  /** The log names a patch, and its record is not there. */
  | { type: "missing-patch"; patchId: PatchId; expectedFile: string }
  | {
      type: "unreadable-patch";
      patchId: PatchId;
      file: string;
      message: string;
    }
  /**
   * A patch directory the log does not name.
   *
   * The benign half of a crash: a record is written before its log line, so an
   * interrupted append leaves the directory behind. Nothing reads it, and repair
   * sweeps it up.
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
  /**
   * The store predates this layout: records that point at their parent, and
   * directories named after the parent rather than the patch.
   *
   * Deliberately not converted. A migration would have to guess at a chain that
   * is, in the cases that matter, already broken - and quietly rewriting someone's
   * unpublished work on startup is not a thing to do on a guess.
   */
  | { status: "legacy-layout"; message: string; patchesDir: string }
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

export function patchBinaryFile(
  patchesDir: string,
  patchId: PatchId,
  filePath: string,
): string {
  return fsPath.join(
    patchDir(patchesDir, patchId),
    "files",
    filePath,
    fsPath.basename(filePath),
  );
}

export function patchBinaryFileMetadata(
  patchesDir: string,
  patchId: PatchId,
  filePath: string,
): string {
  return fsPath.join(
    patchDir(patchesDir, patchId),
    "files",
    filePath,
    "metadata.json",
  );
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
 * Tell a store written by an older Val from this one.
 *
 * Two signals, either of which is conclusive: a directory literally called
 * `head` (the old chain's root), or a record that still carries `parentRef`. The
 * second is the one that matters - it is in the file content, so it survives
 * someone moving directories around.
 */
export function detectLegacyLayout(
  patchesDir: string,
): { isLegacy: true; reason: string } | { isLegacy: false } {
  let names: string[];
  try {
    names = listPatchDirNames(patchesDir);
  } catch {
    return { isLegacy: false };
  }
  if (names.includes("head")) {
    return {
      isLegacy: true,
      reason:
        'it contains a "head" directory, which only the old chain layout wrote',
    };
  }
  for (const name of names) {
    const file = fsPath.join(patchesDir, name, "patch.json");
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    try {
      const json: unknown = JSON.parse(raw);
      if (typeof json === "object" && json !== null && "parentRef" in json) {
        return {
          isLegacy: true,
          reason: `${fsPath.join(name, "patch.json")} still has a "parentRef", which means it was written by an older Val`,
        };
      }
    } catch {
      continue;
    }
  }
  return { isLegacy: false };
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
    const legacy = detectLegacyLayout(patchesDir);
    if (legacy.isLegacy) {
      return {
        status: "legacy-layout",
        patchesDir,
        message: `${patchesDir} was written by an older version of Val: ${legacy.reason}.`,
      };
    }
    logEntries = reconstructLogEntries(patchesDir, dirNames);
    problems.push({
      type: "reconstructed-log",
      entryCount: logEntries.length,
    });
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
    const file = patchRecordFile(patchesDir, logEntry.patchId);
    if (!fs.existsSync(file)) {
      problems.push({
        type: "missing-patch",
        patchId: logEntry.patchId,
        expectedFile: file,
      });
      continue;
    }
    const recordRes = readJsonFile(file, FSPatch);
    if (recordRes.error !== undefined) {
      problems.push({
        type: "unreadable-patch",
        patchId: logEntry.patchId,
        file,
        message: recordRes.error,
      });
      continue;
    }
    const baseFile = patchBaseFile(patchesDir, logEntry.patchId);
    const baseRes = fs.existsSync(baseFile)
      ? readJsonFile(baseFile, FSPatchBase)
      : undefined;
    entries.push({
      patchId: logEntry.patchId,
      record: recordRes.data,
      base: baseRes?.data ?? null,
    });
  }

  for (const name of dirNames) {
    if (!named.has(name)) {
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
  const entry: PatchLogEntry = {
    patchId,
    createdAt: record.createdAt,
    path: record.path,
  };
  appendPatchLogEntry(patchesLogFile(patchesDir), entry);
  return entry;
}

export type RepairAction =
  | { type: "dropped-from-log"; patchId: PatchId; because: string }
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
 * Callers must hold the patch lock.
 */
export function repairPatchStore(
  patchesDir: string,
  read: Extract<ReadPatchStoreResult, { status: "ok" }>,
): RepairAction[] {
  const actions: RepairAction[] = [];
  const needsRewrite = read.problems.some(
    (problem) =>
      problem.type === "missing-patch" ||
      problem.type === "unreadable-patch" ||
      problem.type === "reconstructed-log" ||
      problem.type === "log",
  );

  for (const problem of read.problems) {
    if (problem.type === "missing-patch") {
      actions.push({
        type: "dropped-from-log",
        patchId: problem.patchId,
        because: `its record is missing (expected ${problem.expectedFile})`,
      });
    } else if (problem.type === "unreadable-patch") {
      actions.push({
        type: "dropped-from-log",
        patchId: problem.patchId,
        because: `its record could not be read: ${problem.message}`,
      });
    } else if (problem.type === "orphan-directory") {
      try {
        fs.rmSync(problem.dir, { recursive: true, force: true });
        actions.push({ type: "removed-orphan-directory", name: problem.name });
      } catch {
        // Left in place. It is inert either way - nothing reads a directory the
        // log does not name.
      }
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

/**
 * Leave a trail. Repair drops a person's unpublished edits, and doing that
 * without saying so anywhere durable is how you get someone certain they saved
 * something and no way to tell them what happened to it.
 */
function recordRepair(patchesDir: string, actions: RepairAction[]): void {
  const at = new Date().toISOString();
  const lines = actions.map((action) => {
    if (action.type === "dropped-from-log") {
      return `${at} dropped ${action.patchId}: ${action.because}`;
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
      case "missing-patch":
        return `The change ${problem.patchId} is listed in the log, but ${problem.expectedFile} is not there.`;
      case "unreadable-patch":
        return `The change ${problem.patchId} could not be read from ${problem.file}: ${problem.message}`;
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
