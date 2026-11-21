import { ModuleFilePath, PatchId, initVal } from "@valbuild/core";
import { Script } from "node:vm";
import { transform } from "sucrase";
import fs from "fs";
import path from "node:path";
import os from "node:os";
import { result } from "@valbuild/core/fp";
import synchronizedPrettier from "@prettier/sync";
import { ValOpsFS } from "./ValOpsFS";
import {
  OrderedPatches,
  PatchAnalysis,
  formatPatchSourceError,
} from "./ValOps";

const MODULE_PATH = "/test/cards.val.js" as ModuleFilePath;

const { s, c, config } = initVal();

/**
 * Saving an edit to a module whose objects spread a shared constant into
 * themselves - `{ ...noMedia, learnMore: null }`, the shape valbuild/web's home
 * page used. The edit to a key written after the spread used to be refused,
 * and the refusal itself crashed `/save` with "Converting circular structure
 * to JSON", because the error carried the TypeScript node it was about.
 */
describe("prepare a module whose objects use spreads", () => {
  const createProject = async () => {
    const code = synchronizedPrettier.format(
      `
      import { s, c } from "val.config";

      const noMedia = { video: null };

      export default c.define(
        "${MODULE_PATH}",
        s.array(
          s.object({
            title: s.string(),
            video: s.string().nullable(),
            learnMore: s.string().nullable(),
          }),
        ),
        [
          { title: "First", ...noMedia, learnMore: null },
          { title: "Second", learnMore: "/docs", ...noMedia },
        ],
      );
      `,
      { filepath: "test.val.ts" },
    );
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
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-spread-"));
    const absPath = path.join(rootDir, MODULE_PATH);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, code);
    const ops = new ValOpsFS(
      process.env.VAL_CONTENT_URL || "http://localhost:4000",
      rootDir,
      {
        config,
        modules: [{ def: async () => ({ default: evalModule(code) }) }],
      },
      {
        formatter: (code, filePath) =>
          synchronizedPrettier.format(code, { filepath: filePath }),
        config,
      },
    );
    const prepareWith = async (
      patch: Parameters<typeof ops.createPatch>[1],
    ) => {
      const patchId = crypto.randomUUID() as PatchId;
      const res = await ops.createPatch(
        MODULE_PATH,
        patch,
        patchId,
        { type: "head", headBaseSha: await ops.getBaseSha() },
        null,
        null,
      );
      if (result.isErr(res)) {
        throw new Error(`Could not create patch: ${JSON.stringify(res.error)}`);
      }
      const patchesRes = await ops.fetchPatches({ excludePatchOps: false });
      const analysis: PatchAnalysis & OrderedPatches = {
        ...ops.analyzePatches(patchesRes.patches),
        ...patchesRes,
      };
      return ops.prepare(analysis);
    };
    return { prepareWith };
  };

  test("a key written out after the spread can be edited", async () => {
    const { prepareWith } = await createProject();

    const prepared = await prepareWith([
      { op: "replace", path: ["0", "learnMore"], value: "/blogs/why" },
    ]);

    expect(prepared.hasErrors).toBe(false);
    const patched = prepared.patchedSourceFiles[MODULE_PATH];
    expect(patched).toContain(`learnMore: "/blogs/why"`);
    expect(patched).toContain("...noMedia");
  });

  test("a key a spread supplies is refused, saying where, and the refusal serializes", async () => {
    const { prepareWith } = await createProject();

    const prepared = await prepareWith([
      { op: "replace", path: ["0", "video"], value: "/v.mp4" },
    ]);

    expect(prepared.hasErrors).toBe(true);
    // What `/save` does with it: this threw on the TypeScript node's cycle.
    expect(() => JSON.stringify(prepared.sourceFilePatchErrors)).not.toThrow();
    const messages = prepared.sourceFilePatchErrors[MODULE_PATH].map(
      formatPatchSourceError,
    );
    expect(messages).toEqual([
      expect.stringMatching(
        /^\/test\/cards\.val\.js:\d+:\d+ Cannot edit "video": .*"\.\.\.noMedia"/,
      ),
    ]);
  });

  test("a key a later spread may override is refused", async () => {
    const { prepareWith } = await createProject();

    const prepared = await prepareWith([
      { op: "replace", path: ["1", "learnMore"], value: "/other" },
    ]);

    expect(prepared.hasErrors).toBe(true);
    expect(
      prepared.sourceFilePatchErrors[MODULE_PATH].map(formatPatchSourceError),
    ).toEqual([expect.stringContaining(`"...noMedia" comes after it`)]);
  });
});
