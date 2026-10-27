import fs from "fs";
import os from "os";
import fsPath from "path";
import { ModuleFilePath, PatchId } from "@valbuild/core";
import type { BaseSha } from "./ValOps";
import {
  appendPatch,
  describePatchStoreProblems,
  FSPatchRecord,
  patchesLogFile,
  patchDir,
  patchRecordFile,
  patchRepairLogFile,
  PatchStoreEntry,
  readPatchStore,
  repairPatchStore,
  resetPatchStore,
  writePatchRecord,
} from "./patchStore";
import { readPatchLog } from "./patchLog";

const record = (n: number): FSPatchRecord => ({
  path: "/content/authors.val.ts" as ModuleFilePath,
  patch: [{ op: "replace", path: ["name"], value: `name ${n}` }],
  patchId: `patch-${n}`,
  baseSha: "base-sha" as BaseSha,
  authorId: null,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  coreVersion: "0.102.0",
  sessionId: null,
});

describe("patchStore", () => {
  let patchesDir: string;

  beforeEach(() => {
    patchesDir = fsPath.join(
      fs.mkdtempSync(fsPath.join(os.tmpdir(), "val-patch-store-")),
      "patches",
    );
    fs.mkdirSync(patchesDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(fsPath.dirname(patchesDir), { recursive: true, force: true });
  });

  const readOk = (): {
    entries: PatchStoreEntry[];
    problems: ReturnType<typeof describePatchStoreProblems>;
    raw: Extract<ReturnType<typeof readPatchStore>, { status: "ok" }>;
  } => {
    const res = readPatchStore(patchesDir);
    if (res.status !== "ok") {
      throw new Error(`expected ok, got ${res.status}`);
    }
    return {
      entries: res.entries,
      problems: describePatchStoreProblems(res.problems),
      raw: res,
    };
  };

  const seed = (count: number): void => {
    for (let n = 1; n <= count; n++) {
      appendPatch(patchesDir, record(n));
    }
  };

  test("an empty directory is an empty store", () => {
    expect(readOk()).toMatchObject({ entries: [], problems: [] });
  });

  test("a directory that does not exist is an empty store", () => {
    fs.rmSync(patchesDir, { recursive: true });
    expect(readOk()).toMatchObject({ entries: [], problems: [] });
  });

  test("patches read back in the order they were appended", () => {
    seed(3);
    const { entries, problems } = readOk();
    expect(problems).toEqual([]);
    expect(entries.map((e) => e.patchId)).toEqual([
      "patch-1",
      "patch-2",
      "patch-3",
    ]);
    expect(entries[1].record.patch).toEqual(record(2).patch);
  });

  test("a patch directory is named after the patch, and holds only its own data", () => {
    seed(1);
    expect(fs.existsSync(patchDir(patchesDir, "patch-1" as PatchId))).toBe(
      true,
    );
    const raw: unknown = JSON.parse(
      fs.readFileSync(
        patchRecordFile(patchesDir, "patch-1" as PatchId),
        "utf-8",
      ),
    );
    // The absence of a link to another patch is the design. Nothing here can
    // dangle, because nothing here points anywhere.
    expect(raw).not.toHaveProperty("parentRef");
  });

  /**
   * The bug this store was built to make impossible, stated as the property that
   * failed.
   *
   * A real store lost one record out of 410. `/stat` counted the directories and
   * announced 410; `GET /patches` walked the parent links and delivered 359; the
   * 51 patches written after the lost one were announced, never delivered, and
   * never errored. The studio waited for them forever.
   *
   * Both numbers now come out of the same array, so the only way to fail this is
   * to reintroduce a second source of truth.
   */
  describe("the announced set and the delivered set are the same", () => {
    const faults: [string, () => void][] = [
      [
        "a patch directory removed behind the store's back",
        () =>
          fs.rmSync(patchDir(patchesDir, "patch-3" as PatchId), {
            recursive: true,
          }),
      ],
      [
        "a patch record truncated to nothing",
        () =>
          fs.writeFileSync(
            patchRecordFile(patchesDir, "patch-3" as PatchId),
            "",
          ),
      ],
      [
        "a patch record that is not valid JSON",
        () =>
          fs.writeFileSync(
            patchRecordFile(patchesDir, "patch-3" as PatchId),
            "{ nope",
          ),
      ],
      [
        "an interrupted append: a record with no log line",
        () => writePatchRecord(patchesDir, "patch-99" as PatchId, record(99)),
      ],
      [
        "a log whose last line never finished being written",
        () => fs.appendFileSync(patchesLogFile(patchesDir), "patch-6 2026-01"),
      ],
      [
        "a corrupt line in the middle of the log",
        () => {
          const lines = fs
            .readFileSync(patchesLogFile(patchesDir), "utf-8")
            .split("\n");
          lines[2] = "garbage";
          fs.writeFileSync(patchesLogFile(patchesDir), lines.join("\n"));
        },
      ],
      ["the log deleted entirely", () => fs.rmSync(patchesLogFile(patchesDir))],
    ];

    test.each(faults)("%s", (_name, injectFault) => {
      seed(5);
      injectFault();

      const { entries, raw } = readOk();

      // Every announced id must be one the store can actually hand over: a
      // readable record, holding the ops, under its own name. An entry that
      // fails any of these is a patch `/stat` would promise and `GET /patches`
      // could not produce - which is the failure itself.
      for (const entry of entries) {
        const onDisk: unknown = JSON.parse(
          fs.readFileSync(patchRecordFile(patchesDir, entry.patchId), "utf-8"),
        );
        expect(onDisk).toMatchObject({ patchId: entry.patchId });
        expect(entry.record.patchId).toBe(entry.patchId);
        expect(entry.record.patch.length).toBeGreaterThan(0);
      }
      // And a fault is never silent - that is the other half of the failure.
      expect(raw.problems.length).toBeGreaterThan(0);
    });
  });

  test("a missing record is named in the report, not quietly skipped", () => {
    seed(3);
    fs.rmSync(patchDir(patchesDir, "patch-2" as PatchId), { recursive: true });

    const { entries, problems } = readOk();
    expect(entries.map((e) => e.patchId)).toEqual(["patch-1", "patch-3"]);
    expect(problems.join("\n")).toContain("patch-2");
  });

  /**
   * The one thing the old layout could not do. There, patch-3 hung off patch-2,
   * so losing patch-2 took patch-3 with it. Here the entry after a dropped one is
   * simply next.
   */
  test("losing a patch does not take the patches after it with it", () => {
    seed(5);
    fs.rmSync(patchDir(patchesDir, "patch-2" as PatchId), { recursive: true });

    expect(readOk().entries.map((e) => e.patchId)).toEqual([
      "patch-1",
      "patch-3",
      "patch-4",
      "patch-5",
    ]);
  });

  describe("repair", () => {
    test("drops a missing patch from the log and leaves the store clean", () => {
      seed(3);
      fs.rmSync(patchDir(patchesDir, "patch-2" as PatchId), {
        recursive: true,
      });

      const actions = repairPatchStore(patchesDir, readOk().raw);
      expect(actions).toContainEqual(
        expect.objectContaining({
          type: "removed-unreadable-patch",
          name: "patch-2",
        }),
      );

      const after = readOk();
      expect(after.problems).toEqual([]);
      expect(after.entries.map((e) => e.patchId)).toEqual([
        "patch-1",
        "patch-3",
      ]);
    });

    test("sweeps up a directory the log does not name", () => {
      seed(2);
      writePatchRecord(patchesDir, "patch-99" as PatchId, record(99));

      repairPatchStore(patchesDir, readOk().raw);

      expect(fs.existsSync(patchDir(patchesDir, "patch-99" as PatchId))).toBe(
        false,
      );
      expect(readOk().problems).toEqual([]);
    });

    test("says what it did somewhere durable", () => {
      seed(2);
      fs.rmSync(patchDir(patchesDir, "patch-1" as PatchId), {
        recursive: true,
      });

      repairPatchStore(patchesDir, readOk().raw);

      const audit = fs.readFileSync(patchRepairLogFile(patchesDir), "utf-8");
      expect(audit).toContain("removed patch-1");
    });

    test("does nothing to a healthy store", () => {
      seed(3);
      const before = fs.readFileSync(patchesLogFile(patchesDir), "utf-8");

      expect(repairPatchStore(patchesDir, readOk().raw)).toEqual([]);

      expect(fs.readFileSync(patchesLogFile(patchesDir), "utf-8")).toBe(before);
      expect(fs.existsSync(patchRepairLogFile(patchesDir))).toBe(false);
    });

    test("a torn final line is repaired into a well-formed log", () => {
      seed(2);
      fs.appendFileSync(patchesLogFile(patchesDir), "patch-3 2026-01");

      repairPatchStore(patchesDir, readOk().raw);

      const log = readPatchLog(patchesLogFile(patchesDir));
      if (log.status !== "ok") {
        throw new Error(`expected ok, got ${log.status}`);
      }
      expect(log.problems).toEqual([]);
      expect(log.entries.map((e) => e.patchId)).toEqual(["patch-1", "patch-2"]);
    });
  });

  describe("a log that is gone", () => {
    test("is rebuilt from the records, and reported as a guess", () => {
      seed(3);
      fs.rmSync(patchesLogFile(patchesDir));

      const { entries, problems } = readOk();
      expect(entries.map((e) => e.patchId)).toEqual([
        "patch-1",
        "patch-2",
        "patch-3",
      ]);
      expect(problems.join("\n")).toContain("may not be exact");
    });
  });

  describe("the old layout", () => {
    const writeLegacy = (dirName: string, body: unknown): void => {
      fs.mkdirSync(fsPath.join(patchesDir, dirName), { recursive: true });
      fs.writeFileSync(
        fsPath.join(patchesDir, dirName, "patch.json"),
        JSON.stringify(body),
      );
    };

    /**
     * There is no separate detection for it, and that is deliberate.
     *
     * The old layout named a directory after the record's PARENT. So "the
     * directory does not hold the patch it is named after" catches it, catches a
     * directory someone renamed by hand, and catches a half-finished move — one
     * rule instead of a special case that has to be kept in step with a format
     * nobody supports any more.
     */
    test("is unreadable for the same reason any misnamed directory is", () => {
      writeLegacy("some-parent-id", {
        ...record(1),
        parentRef: { type: "patch", patchId: "some-parent-id" },
      });

      const { entries, problems } = readOk();
      expect(entries).toEqual([]);
      expect(problems.join("\n")).toContain(
        "not the patch its directory is named after",
      );
    });

    test('the "head" directory is unreadable too', () => {
      writeLegacy("head", { ...record(1), parentRef: { type: "head" } });
      expect(readOk().entries).toEqual([]);
      expect(readOk().problems).toHaveLength(1);
    });

    test("repair removes it and the store works again", () => {
      writeLegacy("head", { ...record(1), parentRef: { type: "head" } });

      const actions = repairPatchStore(patchesDir, readOk().raw);

      expect(actions).toContainEqual(
        expect.objectContaining({
          type: "removed-unreadable-patch",
          name: "head",
        }),
      );
      expect(readOk().problems).toEqual([]);
      appendPatch(patchesDir, record(1));
      expect(readOk().entries.map((e) => e.patchId)).toEqual(["patch-1"]);
    });

    test("a store this version wrote is not mistaken for it", () => {
      seed(2);
      expect(readOk().problems).toEqual([]);
    });
  });

  describe("reset", () => {
    test("moves the store aside rather than deleting it", () => {
      seed(2);

      const res = resetPatchStore(patchesDir, "the log could not be read");
      if ("error" in res) {
        throw new Error(res.error);
      }

      expect(fs.existsSync(fsPath.join(res.movedTo, "patch-1"))).toBe(true);
      expect(readOk().entries).toEqual([]);
    });

    test("leaves a note saying where the old store went", () => {
      seed(1);
      const res = resetPatchStore(patchesDir, "the log could not be read");
      if ("error" in res) {
        throw new Error(res.error);
      }

      expect(
        fs.readFileSync(patchRepairLogFile(patchesDir), "utf-8"),
      ).toContain(res.movedTo);
    });
  });
});
