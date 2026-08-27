import fs from "fs";
import os from "os";
import fsPath from "path";
import { ModuleFilePath, PatchId } from "@valbuild/core";
import {
  appendPatchLogEntry,
  parsePatchLog,
  PatchLogEntry,
  readPatchLog,
  serializePatchLog,
  writePatchLogFile,
} from "./patchLog";

const entry = (n: number, path = "/content/authors.val.ts"): PatchLogEntry => ({
  patchId: `patch-${n}` as PatchId,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  path: path as ModuleFilePath,
});

describe("patchLog", () => {
  let dir: string;
  let logFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(fsPath.join(os.tmpdir(), "val-patch-log-"));
    logFile = fsPath.join(dir, "patches.log");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const okRead = (): { entries: PatchLogEntry[]; problems: unknown[] } => {
    const res = readPatchLog(logFile);
    if (res.status !== "ok") {
      throw new Error(`expected ok, got ${res.status}`);
    }
    return res;
  };

  test("no file at all is an empty store, not a broken one", () => {
    expect(readPatchLog(logFile).status).toBe("absent");
  });

  test("appends read back in the order they were written", () => {
    appendPatchLogEntry(logFile, entry(1));
    appendPatchLogEntry(logFile, entry(2));
    appendPatchLogEntry(logFile, entry(3));

    const res = okRead();
    expect(res.problems).toEqual([]);
    expect(res.entries.map((e) => e.patchId)).toEqual([
      "patch-1",
      "patch-2",
      "patch-3",
    ]);
    expect(res.entries[0]).toEqual(entry(1));
  });

  test("the first append writes the header", () => {
    appendPatchLogEntry(logFile, entry(1));
    expect(fs.readFileSync(logFile, "utf-8").split("\n")[0]).toBe(
      "val-patch-log v1",
    );
  });

  test("a module file path containing spaces survives the round trip", () => {
    const spaced = entry(1, "/content/my notes.val.ts");
    appendPatchLogEntry(logFile, spaced);
    expect(okRead().entries).toEqual([spaced]);
  });

  /**
   * The crash this store is built around: the process died part-way through
   * writing the last line. Discarding it is what makes "the log never names a
   * patch that is not there" true.
   */
  test("an unterminated final line is discarded and reported", () => {
    writePatchLogFile(logFile, [entry(1), entry(2)]);
    fs.appendFileSync(logFile, "patch-3 2026-01-01T00");

    const res = okRead();
    expect(res.entries.map((e) => e.patchId)).toEqual(["patch-1", "patch-2"]);
    expect(res.problems).toEqual([
      { type: "torn-final-line", line: "patch-3 2026-01-01T00" },
    ]);
  });

  test("a torn line that happens to parse is still discarded", () => {
    // Nothing about the bytes says "finished"; only the newline does.
    writePatchLogFile(logFile, [entry(1)]);
    fs.appendFileSync(logFile, "patch-2 2026-01-01T00:00:02.000Z /a.val.ts");

    expect(okRead().entries.map((e) => e.patchId)).toEqual(["patch-1"]);
  });

  test("a corrupt line in the middle is reported and the rest is still read", () => {
    const raw = [
      "val-patch-log v1",
      "patch-1 2026-01-01T00:00:01.000Z /content/authors.val.ts",
      "this is not a log line",
      "patch-3 2026-01-01T00:00:03.000Z /content/authors.val.ts",
      "",
    ].join("\n");

    const res = parsePatchLog(raw);
    if (res.status !== "ok") {
      throw new Error(`expected ok, got ${res.status}`);
    }
    expect(res.entries.map((e) => e.patchId)).toEqual(["patch-1", "patch-3"]);
    expect(res.problems).toEqual([
      {
        type: "unparseable-line",
        lineNumber: 3,
        line: "this is not a log line",
      },
    ]);
  });

  test("a line whose path is not a val module is not a log line", () => {
    const res = parsePatchLog(
      [
        "val-patch-log v1",
        "patch-1 2026-01-01T00:00:01.000Z /content/notes.md",
        "",
      ].join("\n"),
    );
    if (res.status !== "ok") {
      throw new Error(`expected ok, got ${res.status}`);
    }
    expect(res.entries).toEqual([]);
    expect(res.problems).toHaveLength(1);
  });

  test("a repeated id is reported and counted once", () => {
    const res = parsePatchLog(
      serializePatchLog([entry(1), entry(2), entry(1)]),
    );
    if (res.status !== "ok") {
      throw new Error(`expected ok, got ${res.status}`);
    }
    expect(res.entries.map((e) => e.patchId)).toEqual(["patch-1", "patch-2"]);
    expect(res.problems).toEqual([
      { type: "duplicate-entry", patchId: "patch-1", lineNumber: 4 },
    ]);
  });

  test("a missing header is reported, and the entries are still read", () => {
    const res = parsePatchLog(
      ["patch-1 2026-01-01T00:00:01.000Z /content/authors.val.ts", ""].join(
        "\n",
      ),
    );
    if (res.status !== "ok") {
      throw new Error(`expected ok, got ${res.status}`);
    }
    expect(res.problems).toEqual([
      {
        type: "missing-header",
        firstLine: "patch-1 2026-01-01T00:00:01.000Z /content/authors.val.ts",
      },
    ]);
    // Reported, but the entry on that line is NOT thrown away to pay for it.
    expect(res.entries.map((e) => e.patchId)).toEqual(["patch-1"]);
  });

  test("a log written by a newer Val is refused rather than guessed at", () => {
    const res = parsePatchLog(["val-patch-log v2", ""].join("\n"));
    if (res.status !== "ok") {
      throw new Error(`expected ok, got ${res.status}`);
    }
    expect(res.problems).toEqual([
      { type: "unsupported-version", header: "val-patch-log v2" },
    ]);
  });

  test("a zero-byte file is empty, not corrupt", () => {
    fs.writeFileSync(logFile, "");
    const res = okRead();
    expect(res.entries).toEqual([]);
    expect(res.problems).toEqual([]);
  });

  test("a rewrite replaces the log and leaves no temporary file behind", () => {
    writePatchLogFile(logFile, [entry(1), entry(2), entry(3)]);
    writePatchLogFile(logFile, [entry(1), entry(3)]);

    expect(okRead().entries.map((e) => e.patchId)).toEqual([
      "patch-1",
      "patch-3",
    ]);
    expect(fs.readdirSync(dir)).toEqual(["patches.log"]);
  });

  test("appending after a rewrite continues the same log", () => {
    writePatchLogFile(logFile, [entry(1)]);
    appendPatchLogEntry(logFile, entry(2));

    expect(okRead().entries.map((e) => e.patchId)).toEqual([
      "patch-1",
      "patch-2",
    ]);
  });

  test("carriage returns do not make a log unreadable", () => {
    fs.writeFileSync(
      logFile,
      [
        "val-patch-log v1",
        "patch-1 2026-01-01T00:00:01.000Z /a.val.ts",
        "",
      ].join("\r\n"),
    );
    const res = okRead();
    expect(res.problems).toEqual([]);
    expect(res.entries.map((e) => e.patchId)).toEqual(["patch-1"]);
  });
});
