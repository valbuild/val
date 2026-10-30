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

const MODULE_PATH = "/test/page.val.js" as ModuleFilePath;

const { s, c, config } = initVal();

/**
 * A save patches a module's FILE and its SOURCE separately: the text is
 * committed, and the Source is what the commit records and every reader is
 * served. When the two disagree -- a proposal whose Source lagged its code
 * did, after the design tab staged a field the Source did not have -- a patch
 * into that field applied to the text and failed on the Source, and the save
 * went through anyway: the text with the edit, the Source without it, the
 * patch marked applied. The edit was gone from what everyone is served, and
 * the next look undid it in the Studio too.
 *
 * Here the file has a `buttons` array its module's Source does not: the same
 * split, made by evaluating an older text than the one on disk.
 */
describe("a patch the file takes and the Source does not", () => {
  const schema = `s.object({
      title: s.string(),
      buttons: s.array(s.object({ label: s.string() })),
    })`;
  const text = (source: string) =>
    synchronizedPrettier.format(
      `
      import { s, c } from "val.config";

      export default c.define("${MODULE_PATH}", ${schema}, ${source});
      `,
      { filepath: "test.val.ts" },
    );
  const onDisk = text(`{ title: "Home", buttons: [{ label: "New" }] }`);
  const evaluated = text(`{ title: "Home", buttons: [] }`);

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

  const project = async (sourceText: string) => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-split-"));
    const absPath = path.join(rootDir, MODULE_PATH);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, onDisk);
    const ops = new ValOpsFS(
      process.env.VAL_CONTENT_URL || "http://localhost:4000",
      rootDir,
      {
        config,
        modules: [{ def: async () => ({ default: evalModule(sourceText) }) }],
      },
      {
        formatter: (code, filePath) =>
          synchronizedPrettier.format(code, { filepath: filePath }),
        config,
      },
    );
    const patchId = crypto.randomUUID() as PatchId;
    const created = await ops.createPatch(
      MODULE_PATH,
      [{ op: "replace", path: ["buttons", "0", "label"], value: "Edited" }],
      patchId,
      { type: "head", headBaseSha: await ops.getBaseSha() },
      null,
      null,
    );
    if (result.isErr(created)) {
      throw new Error(`Could not create patch: ${JSON.stringify(created)}`);
    }
    const patches = await ops.fetchPatches({ excludePatchOps: false });
    const analysis: PatchAnalysis & OrderedPatches = {
      ...ops.analyzePatches(patches.patches),
      ...patches,
    };
    return { prepared: await ops.prepare(analysis), patchId };
  };

  test("refuses the save, and says which change and why", async () => {
    const { prepared, patchId } = await project(evaluated);
    expect(prepared.hasErrors).toBe(true);
    const errors = prepared.sourceFilePatchErrors[MODULE_PATH] ?? [];
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0])).toContain(patchId);
    expect(JSON.stringify(errors[0])).toContain("not to its content");
  });

  test("a file and a Source that agree save as before", async () => {
    const { prepared } = await project(onDisk);
    expect(prepared.hasErrors).toBe(false);
    expect(prepared.moduleVersions[MODULE_PATH]?.source).toEqual({
      title: "Home",
      buttons: [{ label: "Edited" }],
    });
  });
});
