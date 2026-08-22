import { ModuleFilePath, PatchId, initVal } from "@valbuild/core";
import { Script } from "node:vm";
import { transform } from "sucrase";
import fs from "fs";
import path from "node:path";
import os from "node:os";
import { result } from "@valbuild/core/fp";
import synchronizedPrettier from "@prettier/sync";
import { ValOpsFS } from "./ValOpsFS";
import { OrderedPatches, PatchAnalysis } from "./ValOps";

const MODULE_PATH = "/test/projects.val.js" as ModuleFilePath;
const OTHER_MODULE_PATH = "/test/other.val.js" as ModuleFilePath;

const { s, c, config } = initVal();

/**
 * Reproduces the shape of the blankno incident: two editors work on the same
 * array, one shortens it, and the other's in-flight edit to the removed index
 * can no longer be applied. `/save` refuses the whole commit; the studio's
 * compare view never showed a problem because it silently skips such a patch.
 */
describe("prepare with an unappliable patch", () => {
  /** A fresh project with no patches yet. */
  const createProject = async () => {
    const sourceFiles: Record<string, string> = {
      [MODULE_PATH]: synchronizedPrettier.format(
        `
        import { s, c } from "val.config";

        export default c.define(
          "${MODULE_PATH}",
          s.object({
            title: s.string(),
            services: s.array(s.string()),
          }),
          {
            title: "BBL",
            services: ["Strategy", "Design", "Development"],
          },
        );
        `,
        { filepath: "test.val.ts" },
      ),
      [OTHER_MODULE_PATH]: synchronizedPrettier.format(
        `
        import { s, c } from "val.config";

        export default c.define("${OTHER_MODULE_PATH}", s.string(), "untouched");
        `,
        { filepath: "test.val.ts" },
      ),
    };
    const evalModule = (code: string) =>
      new Script(
        transform(code, { transforms: ["imports"] }).code,
      ).runInNewContext({
        exports: {},
        require: (requirePath: string) => {
          if (requirePath === "val.config") {
            return { s, c, config };
          }
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return require(requirePath);
        },
        module: { exports: {} },
      });

    // The OS temp dir, not the repo's .tmp: ValOpsFS.test.ts rmSync's .tmp
    // wholesale on startup, and jest runs test files in parallel workers.
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-continue-"));
    for (const [filePath, code] of Object.entries(sourceFiles)) {
      const absPath = path.join(rootDir, filePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, code);
    }
    const ops = new ValOpsFS(
      process.env.VAL_CONTENT_URL || "http://localhost:4000",
      rootDir,
      {
        config,
        modules: Object.values(sourceFiles).map((code) => ({
          def: async () => ({ default: evalModule(code) }),
        })),
      },
      {
        formatter: (code, filePath) =>
          synchronizedPrettier.format(code, { filepath: filePath }),
        config,
      },
    );

    const patchIds: PatchId[] = [];
    const addPatch = async (
      moduleFilePath: ModuleFilePath,
      patch: Parameters<typeof ops.createPatch>[1],
    ) => {
      const patchId = crypto.randomUUID() as PatchId;
      const parentRef =
        patchIds.length === 0
          ? ({ type: "head", headBaseSha: await ops.getBaseSha() } as const)
          : ({
              type: "patch",
              patchId: patchIds[patchIds.length - 1],
            } as const);
      const res = await ops.createPatch(
        moduleFilePath,
        patch,
        patchId,
        parentRef,
        null,
        null,
      );
      if (result.isErr(res)) {
        throw new Error(`Could not create patch: ${JSON.stringify(res.error)}`);
      }
      patchIds.push(patchId);
      return patchId;
    };

    const analyse = async () => {
      const patchesRes = await ops.fetchPatches({ excludePatchOps: false });
      const analysis: PatchAnalysis & OrderedPatches = {
        ...ops.analyzePatches(patchesRes.patches),
        ...patchesRes,
      };
      return analysis;
    };

    return { ops, addPatch, analyse };
  };

  /**
   * A chain of three patches on the same module. Only the last one is
   * unappliable: patch 2 shortened `services` to two entries, so replacing
   * index 2 is out of bounds by the time patch 3 runs.
   */
  const setup = async () => {
    const { ops, addPatch, analyse } = await createProject();

    const appliesFirst = await addPatch(MODULE_PATH, [
      { op: "replace", path: ["title"], value: "BBL Housing" },
    ]);
    const shortensTheArray = await addPatch(MODULE_PATH, [
      { op: "remove", path: ["services", "2"] },
    ]);
    const unappliable = await addPatch(MODULE_PATH, [
      { op: "replace", path: ["services", "2"], value: "Development U" },
    ]);
    // A different module in the same commit must be unaffected by the failure.
    const otherModulePatch = await addPatch(OTHER_MODULE_PATH, [
      { op: "replace", path: [], value: "touched" },
    ]);

    return {
      ops,
      analysis: await analyse(),
      appliesFirst,
      shortensTheArray,
      unappliable,
      otherModulePatch,
    };
  };

  test("by default it aborts the module, so /save behaviour is unchanged", async () => {
    const { ops, analysis, appliesFirst, shortensTheArray, unappliable } =
      await setup();

    const prepared = await ops.prepare(analysis);

    expect(prepared.hasErrors).toBe(true);
    // The patch is attributed, which is what a caller needs to report or remove
    // it. sourceFilePatchErrors alone does not say which patch failed.
    expect(Object.keys(prepared.unappliablePatches)).toEqual([unappliable]);
    expect(prepared.unappliablePatches[unappliable].message).toBe(
      "Array index out of bounds",
    );
    expect(prepared.unappliablePatches[unappliable].moduleFilePath).toBe(
      MODULE_PATH,
    );
    expect(prepared.appliedPatches[MODULE_PATH]).toEqual([
      appliesFirst,
      shortensTheArray,
    ]);
    // Nothing is written for a module that had a failure.
    expect(prepared.patchedSourceFiles[MODULE_PATH]).toBeUndefined();
    expect(prepared.partiallyPatchedSourceFiles[MODULE_PATH]).toBeUndefined();
  });

  test("continueOnError reports every failure and still refuses the commit", async () => {
    const { ops, analysis, appliesFirst, shortensTheArray, unappliable } =
      await setup();

    const prepared = await ops.prepare(analysis, { continueOnError: true });

    expect(Object.keys(prepared.unappliablePatches)).toEqual([unappliable]);
    // The appliable patches still land, so a diagnosis can show what would be
    // written - but the commit is still refused.
    expect(prepared.appliedPatches[MODULE_PATH]).toEqual([
      appliesFirst,
      shortensTheArray,
    ]);
    expect(prepared.hasErrors).toBe(true);
    expect(prepared.patchedSourceFiles[MODULE_PATH]).toBeUndefined();
    const partial = prepared.partiallyPatchedSourceFiles[MODULE_PATH];
    expect(partial).toContain("BBL Housing");
    expect(partial).not.toContain("Development");
  });

  test("a patch with several source ops is applied exactly once", async () => {
    // analyzePatches used to push the patch id once per non-file op, and
    // prepare re-looks-up the patch by id and applies the whole thing per
    // entry - so a two-op patch ran twice. Idempotent for "replace", but two
    // appends became four entries.
    const { ops, addPatch, analyse } = await createProject();
    const patchId = await addPatch(MODULE_PATH, [
      { op: "add", path: ["services", "-"], value: "Research" },
      { op: "add", path: ["services", "-"], value: "Testing" },
    ]);
    const analysis = await analyse();

    expect(analysis.patchesByModule[MODULE_PATH]).toEqual([{ patchId }]);

    const prepared = await ops.prepare(analysis);

    expect(prepared.hasErrors).toBe(false);
    expect(prepared.appliedPatches[MODULE_PATH]).toEqual([patchId]);
    const patched = prepared.patchedSourceFiles[MODULE_PATH];
    expect(patched?.match(/"Research"/g)).toHaveLength(1);
    expect(patched?.match(/"Testing"/g)).toHaveLength(1);
  });

  test("a file-only patch adds no source-file work", async () => {
    // The op loop still has to run for file ops, but a patch without source ops
    // must not appear in patchesByModule at all.
    const { addPatch, analyse } = await createProject();
    await addPatch(MODULE_PATH, [
      {
        op: "file",
        path: ["services"],
        filePath: "/public/val/x.png",
        value: "data:image/png;base64,AA==",
        remote: false,
      },
    ]);

    const analysis = await analyse();

    expect(analysis.patchesByModule[MODULE_PATH]).toBeUndefined();
    expect(
      analysis.fileLastUpdatedByPatchId["/public/val/x.png"],
    ).toBeDefined();
  });

  test("a failure in one module does not affect another module in the same commit", async () => {
    const { ops, analysis, otherModulePatch } = await setup();

    const prepared = await ops.prepare(analysis, { continueOnError: true });

    expect(prepared.appliedPatches[OTHER_MODULE_PATH]).toEqual([
      otherModulePatch,
    ]);
    expect(prepared.patchedSourceFiles[OTHER_MODULE_PATH]).toContain("touched");
    expect(prepared.sourceFilePatchErrors[OTHER_MODULE_PATH]).toBeUndefined();
  });
});
