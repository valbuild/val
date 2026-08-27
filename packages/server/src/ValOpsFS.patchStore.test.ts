import fs from "fs";
import os from "os";
import path from "node:path";
import { initVal, ModuleFilePath, PatchId } from "@valbuild/core";
import { ParentRef } from "@valbuild/shared/internal";
import { ValOpsFS } from "./ValOpsFS";
import type { BaseSha, SchemaSha, SourcesSha } from "./ValOps";
import { patchDir, patchesLogFile } from "./patchStore";

const { s, c, config } = initVal();

const MODULE_PATH = "/test/page.val.ts" as ModuleFilePath;

/**
 * End-to-end cover for the failure this store was rewritten around.
 *
 * A real `.val/patches` holding 410 unpublished changes lost one record. `/stat`
 * counted the directories and announced 410; `GET /patches` walked the parent
 * links between them and delivered 359; the 51 changes written after the lost
 * one were announced, never delivered, and never errored, so the studio sat on
 * "Loading unpublished changes…" until it gave up.
 *
 * These tests drive the real `ValOpsFS` - both endpoints, against a real
 * directory - because the bug lived precisely in the gap between two methods
 * that each looked correct on their own.
 */
describe("ValOpsFS patch store", () => {
  let rootDir: string;
  let ops: ValOpsFS;

  const patchesDir = (): string => path.join(rootDir, ".val", "patches");

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-ops-fs-store-"));
    fs.mkdirSync(path.join(rootDir, "test"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDir, "test", "page.val.ts"),
      `import { s, c } from "val.config";\n\nexport default c.define(\n  "${MODULE_PATH}",\n  s.object({ title: s.string() }),\n  { title: "start" },\n);\n`,
    );
    ops = new ValOpsFS(
      "http://localhost:4000",
      rootDir,
      {
        config,
        modules: [
          {
            def: async () => ({
              default: c.define(MODULE_PATH, s.object({ title: s.string() }), {
                title: "start",
              }),
            }),
          },
        ],
      },
      { config },
    );
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  /** Create `count` patches, each chained onto the one before, as a client does. */
  const createPatches = async (count: number): Promise<PatchId[]> => {
    const created: PatchId[] = [];
    let parentRef: ParentRef = {
      type: "head",
      headBaseSha: await ops.getBaseSha(),
    };
    for (let n = 0; n < count; n++) {
      const patchId = `patch-${n}` as PatchId;
      const res = await ops.createPatch(
        MODULE_PATH,
        [{ op: "replace", path: ["title"], value: `title ${n}` }],
        patchId,
        parentRef,
        null,
        null,
      );
      if (res.kind !== "ok") {
        throw new Error(
          `could not create patch ${n}: ${JSON.stringify(res.error)}`,
        );
      }
      created.push(patchId);
      parentRef = { type: "patch", patchId };
    }
    return created;
  };

  const announced = async (): Promise<PatchId[]> => {
    // Shas that cannot match, so getStat answers immediately with what it sees
    // rather than long-polling for a change.
    const stat = await ops.getStat({
      baseSha: "never-matches" as BaseSha,
      schemaSha: "never-matches" as SchemaSha,
      sourcesSha: "never-matches" as SourcesSha,
      patches: [],
    });
    if (stat.type === "error") {
      throw new Error(`getStat failed: ${stat.error.message}`);
    }
    if (stat.type !== "did-change") {
      throw new Error(`expected did-change, got ${stat.type}`);
    }
    return stat.patches;
  };

  /** What the next stat tells the studio it threw away. */
  const removedNotice = async (): Promise<
    { patchId: PatchId; reason: string }[] | undefined
  > => {
    const stat = await ops.getStat({
      baseSha: "never-matches" as BaseSha,
      schemaSha: "never-matches" as SchemaSha,
      sourcesSha: "never-matches" as SourcesSha,
      patches: [],
    });
    if (stat.type !== "did-change") {
      throw new Error(`expected did-change, got ${stat.type}`);
    }
    return stat.removed;
  };

  const delivered = async (): Promise<PatchId[]> => {
    const res = await ops.fetchPatches({ excludePatchOps: false });
    if (res.error) {
      throw new Error(`fetchPatches failed: ${res.error.message}`);
    }
    return res.patches.map((patch) => patch.patchId);
  };

  test("patches come back in the order they were created", async () => {
    await createPatches(4);
    expect(await delivered()).toEqual([
      "patch-0",
      "patch-1",
      "patch-2",
      "patch-3",
    ]);
    expect(await announced()).toEqual(await delivered());
  });

  test("a patch directory is named after the patch itself", async () => {
    await createPatches(2);
    expect(fs.existsSync(patchDir(patchesDir(), "patch-0" as PatchId))).toBe(
      true,
    );
    expect(fs.existsSync(patchDir(patchesDir(), "patch-1" as PatchId))).toBe(
      true,
    );
  });

  describe("what /stat announces is what GET /patches delivers", () => {
    const faults: [string, (dir: string) => void][] = [
      [
        "a patch directory removed behind the server's back",
        (dir) =>
          fs.rmSync(patchDir(dir, "patch-2" as PatchId), { recursive: true }),
      ],
      [
        "a patch record left empty by an interrupted write",
        (dir) =>
          fs.writeFileSync(
            path.join(patchDir(dir, "patch-2" as PatchId), "patch.json"),
            "",
          ),
      ],
      [
        "a log whose last line never finished being written",
        (dir) => fs.appendFileSync(patchesLogFile(dir), "patch-9 2026-01"),
      ],
      ["the log removed entirely", (dir) => fs.rmSync(patchesLogFile(dir))],
    ];

    test.each(faults)("%s", async (_name, injectFault) => {
      await createPatches(5);
      injectFault(patchesDir());

      // Read the delivered set FIRST, so that if the announce path were the one
      // repairing the store the two would still be compared honestly.
      const deliveredIds = await delivered();
      expect(await announced()).toEqual(deliveredIds);
    });
  });

  test("losing one patch does not strand the patches created after it", async () => {
    await createPatches(5);
    fs.rmSync(patchDir(patchesDir(), "patch-1" as PatchId), {
      recursive: true,
    });

    // The old layout chained patch-2 onto patch-1, so this took patch-2, -3 and
    // -4 with it - silently, and only on the delivering side.
    expect(await delivered()).toEqual([
      "patch-0",
      "patch-2",
      "patch-3",
      "patch-4",
    ]);
  });

  test("the ops of every delivered patch actually arrive", async () => {
    await createPatches(3);
    const res = await ops.fetchPatches({ excludePatchOps: false });
    for (const patch of res.patches) {
      expect(patch.patch).toHaveLength(1);
    }
  });

  describe("parentRef", () => {
    /**
     * It is ignored, and that is the point of the log.
     *
     * It used to be the directory name, which is how a client working from a
     * stale view could write a patch whose parent had never landed and strand
     * every patch behind it. With the order in one append-only list the server
     * decides where a patch goes — last — so there is no parent to name and
     * nothing that can point at nothing.
     */
    test("naming a parent that never existed just appends", async () => {
      await createPatches(2);

      const res = await ops.createPatch(
        MODULE_PATH,
        [
          {
            op: "replace",
            path: ["title"],
            value: "on a parent that is not there",
          },
        ],
        "no-such-parent" as PatchId,
        { type: "patch", patchId: "never-existed" as PatchId },
        null,
        null,
      );

      expect(res.kind).toBe("ok");
      expect(await delivered()).toEqual([
        "patch-0",
        "patch-1",
        "no-such-parent",
      ]);
      expect(await announced()).toEqual(await delivered());
    });

    test("naming a stale parent appends in arrival order, not at the parent", async () => {
      await createPatches(3);

      // A second tab that missed the last two writes. Its edit is still an edit;
      // putting it last is the only ordering that exists.
      await ops.createPatch(
        MODULE_PATH,
        [{ op: "replace", path: ["title"], value: "from a stale tab" }],
        "stale" as PatchId,
        { type: "patch", patchId: "patch-0" as PatchId },
        null,
        null,
      );

      expect(await delivered()).toEqual([
        "patch-0",
        "patch-1",
        "patch-2",
        "stale",
      ]);
    });

    test("naming head on a store that is not empty appends too", async () => {
      await createPatches(1);

      const res = await ops.createPatch(
        MODULE_PATH,
        [{ op: "replace", path: ["title"], value: "second head" }],
        "second-head" as PatchId,
        { type: "head", headBaseSha: await ops.getBaseSha() },
        null,
        null,
      );

      expect(res.kind).toBe("ok");
      expect(await delivered()).toEqual(["patch-0", "second-head"]);
    });
  });

  describe("repair", () => {
    test("drops what it cannot read, and says so", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      await createPatches(3);
      fs.rmSync(patchDir(patchesDir(), "patch-1" as PatchId), {
        recursive: true,
      });

      expect(await delivered()).toEqual(["patch-0", "patch-2"]);

      expect(warn.mock.calls.flat().join("\n")).toContain("patch-1");
      // And the next read is clean, rather than warning forever.
      warn.mockClear();
      expect(await delivered()).toEqual(["patch-0", "patch-2"]);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    test("leaves a healthy store completely alone", async () => {
      await createPatches(3);
      const before = fs.readFileSync(patchesLogFile(patchesDir()), "utf-8");

      await delivered();
      await announced();

      expect(fs.readFileSync(patchesLogFile(patchesDir()), "utf-8")).toBe(
        before,
      );
    });
  });

  describe("a store written by an older Val", () => {
    const writeLegacyStore = (): void => {
      // The old layout: a directory named after the record's PARENT, and a
      // record that points at it.
      const dir = path.join(patchesDir(), "head");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "patch.json"),
        JSON.stringify({
          path: MODULE_PATH,
          patch: [{ op: "replace", path: ["title"], value: "old" }],
          patchId: "from-an-older-val",
          baseSha: "whatever",
          parentRef: { type: "head", headBaseSha: "whatever" },
          authorId: null,
          createdAt: new Date().toISOString(),
          coreVersion: "0.101.0",
          sessionId: null,
        }),
      );
    };

    /**
     * Not special-cased, and not converted. There is nothing to recover: the
     * order lived in links that are exactly what goes wrong, so an old store is
     * read as a pile of directories that do not hold the patch they are named
     * after — the same as any other unusable directory — and removed.
     */
    test("is cleaned up rather than refused, so the studio still loads", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      writeLegacyStore();

      const res = await ops.fetchPatches({ excludePatchOps: false });

      expect(res.error).toBeUndefined();
      expect(res.patches).toEqual([]);
      expect(fs.existsSync(path.join(patchesDir(), "head"))).toBe(false);
      warn.mockRestore();
    });

    test("tells the person editing that their changes were thrown away", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      writeLegacyStore();

      // On STAT, not on the fetch. Repair here removes everything, so there is
      // nothing left for the studio to fetch - a notice riding on GET /patches
      // would never be collected. Discarding unpublished work silently is the
      // one thing this must not do.
      expect(await removedNotice()).toEqual([
        {
          patchId: "head",
          reason: expect.stringContaining(
            "not the patch its directory is named after",
          ),
        },
      ]);
      warn.mockRestore();
    });

    test("says it once, not on every stat", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      writeLegacyStore();

      await removedNotice();

      // A notice that never clears is a toast on the screen forever.
      expect(await removedNotice()).toBeUndefined();
      warn.mockRestore();
    });

    test("writes down what it removed, for whoever has to explain it later", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      writeLegacyStore();

      await ops.fetchPatches({ excludePatchOps: false });

      const audit = fs.readFileSync(
        path.join(patchesDir(), "patches.repair.log"),
        "utf-8",
      );
      expect(audit).toContain("removed head");
      warn.mockRestore();
    });

    test("does not take a healthy store's patches with it", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      await createPatches(2);
      writeLegacyStore();

      const res = await ops.fetchPatches({ excludePatchOps: false });

      expect(res.patches.map((patch) => patch.patchId)).toEqual([
        "patch-0",
        "patch-1",
      ]);
      expect(await removedNotice()).toHaveLength(1);
      warn.mockRestore();
    });
  });

  describe("delete", () => {
    test("removes the named patches and keeps the rest in order", async () => {
      await createPatches(4);

      const res = await ops.deletePatches(["patch-1", "patch-2"] as PatchId[]);

      expect(res.deleted).toEqual(["patch-1", "patch-2"]);
      expect(res.errors).toBeUndefined();
      expect(await delivered()).toEqual(["patch-0", "patch-3"]);
      expect(await announced()).toEqual(["patch-0", "patch-3"]);
    });

    test("takes the files with it", async () => {
      await createPatches(2);
      await ops.deletePatches(["patch-0"] as PatchId[]);
      expect(fs.existsSync(patchDir(patchesDir(), "patch-0" as PatchId))).toBe(
        false,
      );
    });

    test("a patch created after a delete chains onto the new tail", async () => {
      await createPatches(3);
      await ops.deletePatches(["patch-2"] as PatchId[]);

      const res = await ops.createPatch(
        MODULE_PATH,
        [{ op: "replace", path: ["title"], value: "after the delete" }],
        "after" as PatchId,
        { type: "patch", patchId: "patch-1" as PatchId },
        null,
        null,
      );

      expect(res.kind).toBe("ok");
      expect(await delivered()).toEqual(["patch-0", "patch-1", "after"]);
    });
  });

  test("concurrent creates against the same parent both survive", async () => {
    await createPatches(1);
    const parentRef: ParentRef = {
      type: "patch",
      patchId: "patch-0" as PatchId,
    };

    // Both name patch-0 as their parent. The old store wrote both into a
    // directory named after that parent, so the one that arrived second silently
    // overwrote the first and everything chained behind the overwritten patch
    // became unreachable. Now they are two lines in a list.
    const [a, b] = await Promise.all([
      ops.createPatch(
        MODULE_PATH,
        [{ op: "replace", path: ["title"], value: "a" }],
        "concurrent-a" as PatchId,
        parentRef,
        null,
        null,
      ),
      ops.createPatch(
        MODULE_PATH,
        [{ op: "replace", path: ["title"], value: "b" }],
        "concurrent-b" as PatchId,
        parentRef,
        null,
        null,
      ),
    ]);

    expect([a.kind, b.kind]).toEqual(["ok", "ok"]);
    const ids = await delivered();
    expect(ids[0]).toBe("patch-0");
    expect(ids.slice(1).sort()).toEqual(["concurrent-a", "concurrent-b"]);
    expect(await announced()).toEqual(ids);
  });
});
