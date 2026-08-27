import { ModuleFilePath, PatchId } from "@valbuild/core";
import fs from "fs";
import fsPath from "path";

/**
 * The order of the pending patches, held in one flat, append-only text file.
 *
 * ## Why a log and not links between the patches
 *
 * The store this replaces kept the order in the patches themselves: every record
 * carried a `parentRef`, and the directory a record lived in was named after that
 * parent. Reading the chain meant walking those links from `head`, and the walk
 * stopped dead — silently — at the first id nothing on disk answered for.
 *
 * That is not a hypothetical. A store with 410 patches lost exactly one record,
 * and the 51 patches written after it became unreachable: `/stat` counted the
 * directories and announced 410, `GET /patches` walked the links and delivered
 * 359, and the studio waited forever for 51 ids that no longer had a path back to
 * `head`. One missing file cost every edit made after it.
 *
 * So the order lives in one place and the patches reference nothing. A patch
 * directory is self-contained data; this file says what order the directories go
 * in. Removing a line cannot orphan the lines below it, because there is nothing
 * below it to orphan — the entry after a dropped one is simply next.
 *
 * ## Why text
 *
 * It is read by people during exactly the incidents that make it interesting, and
 * `cat` should be enough. One entry per line, whitespace-separated, id first:
 *
 * ```
 * val-patch-log v1
 * 659b8cfa-065c-47d1-8d82-fc69a2ac72a9 2026-08-27T11:46:13.730Z /content/authors.val.ts
 * ```
 *
 * Position in the file IS the order. There is deliberately no sequence number:
 * a number stored beside the thing it describes is a number that can disagree
 * with it, and then something has to decide which one lies.
 *
 * The timestamp and path are there to make the file readable, not to be believed
 * — `patch.json` owns those fields. Nothing here is a second copy of state that
 * anything reads back.
 */

export const PATCH_LOG_FILE_NAME = "patches.log";

const HEADER = "val-patch-log v1";

export type PatchLogEntry = {
  patchId: PatchId;
  createdAt: string;
  path: ModuleFilePath;
};

/**
 * Something that is wrong with the file but does not stop it being read.
 *
 * Reported rather than thrown, because a log that is 99% intact is worth reading
 * and then repairing. Only a file that cannot be understood at all is fatal, and
 * that is a `status` on the read result, not a problem in this list.
 */
export type PatchLogProblem =
  | {
      type: "missing-header";
      /** What stood where the header should have been. */
      firstLine: string;
    }
  | { type: "unsupported-version"; header: string }
  | { type: "unparseable-line"; lineNumber: number; line: string }
  | { type: "duplicate-entry"; patchId: PatchId; lineNumber: number }
  /**
   * A final line with no newline after it: a write that did not finish.
   *
   * Discarded rather than guessed at, and only ever possible on the LAST line —
   * appends are serialized by the patch lock, so no other writer can have got in
   * behind an interrupted one.
   */
  | { type: "torn-final-line"; line: string };

export type ReadPatchLogResult =
  | { status: "ok"; entries: PatchLogEntry[]; problems: PatchLogProblem[] }
  /** No log file at all — an empty store, not a broken one. */
  | { status: "absent" }
  | { status: "unreadable"; message: string };

function isModuleFilePath(path: string): path is ModuleFilePath {
  return path.startsWith("/") && path.includes(".val.");
}

function isPatchId(patchId: string): patchId is PatchId {
  return patchId.length > 0 && !/\s/.test(patchId);
}

export function formatPatchLogLine(entry: PatchLogEntry): string {
  return `${entry.patchId} ${entry.createdAt} ${entry.path}`;
}

/**
 * Split on the first two runs of whitespace only: a module file path may contain
 * spaces, and it is last precisely so that it can.
 */
export function parsePatchLogLine(line: string): PatchLogEntry | null {
  const trimmed = line.trim();
  if (trimmed === "") {
    return null;
  }
  const match = /^(\S+)\s+(\S+)\s+(.+)$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const [, patchId, createdAt, path] = match;
  if (!isPatchId(patchId) || !isModuleFilePath(path)) {
    return null;
  }
  return { patchId, createdAt, path };
}

export function serializePatchLog(entries: readonly PatchLogEntry[]): string {
  return [HEADER, ...entries.map(formatPatchLogLine), ""].join("\n");
}

export function readPatchLog(logFilePath: string): ReadPatchLogResult {
  let raw: string;
  try {
    raw = fs.readFileSync(logFilePath, "utf-8");
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      return { status: "absent" };
    }
    return {
      status: "unreadable",
      message: `Could not read ${logFilePath}: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
    };
  }
  return parsePatchLog(raw);
}

export function parsePatchLog(raw: string): ReadPatchLogResult {
  const problems: PatchLogProblem[] = [];
  // A zero-byte file is a store that was created and then interrupted before the
  // header landed. Empty, not broken: there are no patches either way.
  if (raw === "") {
    return { status: "ok", entries: [], problems };
  }

  const endsWithNewline = raw.endsWith("\n");
  const lines = raw.split("\n");
  // `split` always leaves a trailing "" when the text ends in a newline; when it
  // does not, the last element is a line whose write never finished.
  const tornFinalLine = endsWithNewline ? null : lines[lines.length - 1];
  lines.pop();
  if (tornFinalLine !== null && tornFinalLine.trim() !== "") {
    problems.push({ type: "torn-final-line", line: tornFinalLine });
  }

  // Only consume the first line when it really is the header. A headerless file
  // is reported, but its first line is still offered to the entry parser rather
  // than eaten: dropping a real patch to pay for a missing header would be the
  // same silent data loss this store exists to stop.
  const firstLine = (lines[0] ?? "").replace(/\r$/, "");
  let firstEntryIndex = 0;
  if (firstLine === HEADER) {
    firstEntryIndex = 1;
  } else if (firstLine.startsWith("val-patch-log ")) {
    problems.push({ type: "unsupported-version", header: firstLine });
    firstEntryIndex = 1;
  } else {
    problems.push({ type: "missing-header", firstLine });
  }

  const entries: PatchLogEntry[] = [];
  const seen = new Set<PatchId>();
  lines.slice(firstEntryIndex).forEach((rawLine, index) => {
    const line = rawLine.replace(/\r$/, "");
    // 1-based and counted from the top of the file, so they match what an editor
    // shows the person reading this report.
    const lineNumber = firstEntryIndex + index + 1;
    if (line.trim() === "") {
      return;
    }
    const entry = parsePatchLogLine(line);
    if (entry === null) {
      problems.push({ type: "unparseable-line", lineNumber, line });
      return;
    }
    if (seen.has(entry.patchId)) {
      problems.push({
        type: "duplicate-entry",
        patchId: entry.patchId,
        lineNumber,
      });
      return;
    }
    seen.add(entry.patchId);
    entries.push(entry);
  });

  return { status: "ok", entries, problems };
}

/**
 * fsync the directory holding a file, so a rename or create survives a power cut.
 *
 * Best-effort: opening a directory is not permitted on Windows, and a store that
 * refuses to work there to buy durability nobody asked for is the worse trade.
 */
function fsyncDir(dirPath: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dirPath, "r");
    fs.fsyncSync(fd);
  } catch {
    // ignore: see above
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Add one entry to the end of the log.
 *
 * A single `writeSync` on an append-only descriptor, then fsync: the whole line
 * reaches the file or none of it does, and a reader that catches it mid-flight
 * discards the partial last line rather than misreading it.
 *
 * Callers must hold the patch lock. That is what makes "the torn line can only be
 * the last one" true, and it is why this does not try to be safe against
 * concurrent appends on its own.
 */
export function appendPatchLogEntry(
  logFilePath: string,
  entry: PatchLogEntry,
): void {
  const dirPath = fsPath.dirname(logFilePath);
  fs.mkdirSync(dirPath, { recursive: true });
  if (!fs.existsSync(logFilePath)) {
    writePatchLogFile(logFilePath, []);
  }
  const fd = fs.openSync(logFilePath, "a");
  try {
    fs.writeSync(fd, `${formatPatchLogLine(entry)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Replace the log wholesale — used by delete and by repair.
 *
 * Write a sibling temp file, fsync it, then rename over the original: a rename is
 * atomic, so a reader either sees the old log or the new one and never a
 * half-rewritten file. In-place truncation would have a window where the log is
 * short and the store looks like it lost patches.
 *
 * Callers must hold the patch lock.
 */
export function writePatchLogFile(
  logFilePath: string,
  entries: readonly PatchLogEntry[],
): void {
  const dirPath = fsPath.dirname(logFilePath);
  fs.mkdirSync(dirPath, { recursive: true });
  const tmpPath = `${logFilePath}.tmp-${process.pid}`;
  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, serializePatchLog(entries));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, logFilePath);
  fsyncDir(dirPath);
}
