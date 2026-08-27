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

  describe("parentRef is checked, not just used as a name", () => {
    test("a patch naming a parent the server never accepted is refused", async () => {
      await createPatches(2);

      const res = await ops.createPatch(
        MODULE_PATH,
        [{ op: "replace", path: ["title"], value: "written on a ghost" }],
        "orphan" as PatchId,
        // A parent that does not exist. This used to be written happily, into a
        // directory named after the missing id, and everything chained behind it
        // was then unreachable.
        { type: "patch", patchId: "never-existed" as PatchId },
        null,
        null,
      );

      if (res.kind !== "err") {
        throw new Error("expected the patch to be refused");
      }
      expect(res.error.errorType).toBe("patch-head-conflict");
      expect(await delivered()).toEqual(["patch-0", "patch-1"]);
    });

    test("a patch naming a stale parent is refused, and told where the server is", async () => {
      await createPatches(3);

      const res = await ops.createPatch(
        MODULE_PATH,
        [{ op: "replace", path: ["title"], value: "from a stale tab" }],
        "stale" as PatchId,
        { type: "patch", patchId: "patch-0" as PatchId },
        null,
        null,
      );

      if (res.kind !== "err" || res.error.errorType !== "patch-head-conflict") {
        throw new Error("expected a patch-head-conflict");
      }
      // Enough for the client to rebase without waiting for the next stat.
      expect(res.error.tail).toBe("patch-2");
    });

    test("a patch naming head is refused once the store is not empty", async () => {
      await createPatches(1);

      const res = await ops.createPatch(
        MODULE_PATH,
        [{ op: "replace", path: ["title"], value: "second head" }],
        "second-head" as PatchId,
        { type: "head", headBaseSha: await ops.getBaseSha() },
        null,
        null,
      );

      if (res.kind !== "err") {
        throw new Error("expected the patch to be refused");
      }
      expect(res.error.errorType).toBe("patch-head-conflict");
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

    test("is refused loudly rather than read as an empty store", async () => {
      writeLegacyStore();

      const res = await ops.fetchPatches({ excludePatchOps: false });
      expect(res.patches).toEqual([]);
      expect(res.error?.message).toContain("older version of Val");
      // An empty answer with no error would be read as "nothing is pending", and
      // the studio would quietly render published content over unpublished work.
      expect(res.error).toBeDefined();
    });

    test("is not silently converted or deleted", async () => {
      writeLegacyStore();
      const before = fs.readFileSync(
        path.join(patchesDir(), "head", "patch.json"),
        "utf-8",
      );

      await ops.fetchPatches({ excludePatchOps: false });

      expect(
        fs.readFileSync(path.join(patchesDir(), "head", "patch.json"), "utf-8"),
      ).toBe(before);
    });

    test("can be cleared by discarding all changes", async () => {
      writeLegacyStore();

      expect(await ops.deleteAllPatches()).toEqual({});

      const res = await ops.fetchPatches({ excludePatchOps: false });
      expect(res.error).toBeUndefined();
      expect(res.patches).toEqual([]);
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

  test("concurrent creates against the same parent do not lose one", async () => {
    await createPatches(1);
    const parentRef: ParentRef = {
      type: "patch",
      patchId: "patch-0" as PatchId,
    };

    // Both name patch-0 as their parent. Exactly one can win - and the loser must
    // be REFUSED, not written on top of the winner. The old store had neither
    // guard: the write that arrived second silently overwrote the first, and
    // everything chained behind the overwritten patch became unreachable.
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

    const winners = [a, b].filter((res) => res.kind === "ok");
    expect(winners).toHaveLength(1);

    const ids = await delivered();
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("patch-0");
    expect(await announced()).toEqual(ids);
  });
});
