/* eslint-disable @typescript-eslint/no-unused-vars */
import { ModuleFilePath, PatchId, initVal } from "@valbuild/core";
import { Script } from "node:vm";
import { transform } from "sucrase";
import { ValOpsFS } from "./ValOpsFS";
import fs from "fs";
import path from "node:path";
import synchronizedPrettier from "@prettier/sync";
import { result } from "@valbuild/core/fp";

describe("ValOpsFS", () => {
  test("flow", async () => {
    // #region test setup
    const smallPngBuffer =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";

    if (!smallPngBuffer) {
      throw new Error("Could not create test buffer from data url");
    }
    const anotherSmallPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAABAQAAAADLe9LuAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==";

    const { s, c, config } = initVal();
    /**
     * Eval modules that only imports val.config (to make things easier)
     * Only useful for basic tests
     */
    const evalModuleOnlyImportsValConfig = (code: string) => {
      const res = new Script(
        transform(code, {
          transforms: ["imports"],
        }).code,
      ).runInNewContext({
        exports: {},
        require: (path: string) => {
          if (path === "val.config") {
            return { s, c, config };
          } else {
            return require(path);
          }
        },
        module: { exports: {} },
      });
      return res;
    };

    // #region test modules
    const sourceFiles: Record<string, string> = {
      "/test/test1.val.js": synchronizedPrettier.format(
        `
      import { s, c } from "val.config";
      
      export default c.define(
        "/test/test1.val.js",
        s.object({
          test: s.string().min(3),
          testImage: s.image(),
        }),
        {
          test: "Test 1 2 3",
          testImage: c.file("/public/val/test.png", {
            height: 12,
            width: 1,
            mimeType: "image/png",
          }),
        }
      );
      `,
        { parser: "babel" },
      ),
      "/test/test2.val.js": synchronizedPrettier.format(
        `
      import { s, c } from "val.config";
      
      export default c.define(
        "/test/test2.val.js",
        s.object({
          test: s.string().min(30),
          testImage: s.image(),
        }),
        {
          test: "Test 1 2 3",
          testImage: c.file("/public/val/test.png", {
            height: 1,
            width: 1,
            mimeType: "image/png",
          }),
        }
      );
      `,
        { parser: "babel" },
      ),
    };
    const binaryFiles = {
      "/public/test.png": smallPngBuffer,
    };

    const fakeModules = Object.values(sourceFiles).map((code) => {
      return {
        def: async () => {
          return {
            default: evalModuleOnlyImportsValConfig(code),
          };
        },
      };
    });

    const tmpDir = ".tmp";
    fs.rmSync(tmpDir, { recursive: true, force: true }); // TODO: remove this
    fs.mkdirSync(tmpDir, { recursive: true });
    const rootDir = fs.mkdtempSync(path.join(tmpDir, "val-ops-test"));
    console.log("Root dir is: " + path.join(process.cwd(), rootDir));

    for (const [filePath, code] of Object.entries(sourceFiles)) {
      const absPath = path.join(rootDir, filePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, code);
    }
    for (const [filePath, base64UrlData] of Object.entries(binaryFiles)) {
      const absPath = path.join(rootDir, filePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(
        path.join(rootDir, filePath),
        base64UrlData,
        "base64url",
      );
    }

    const ops = new ValOpsFS(
      rootDir,
      {
        config,
        modules: fakeModules,
      },
      {
        formatter: (code, filePath) =>
          synchronizedPrettier.format(code, { filepath: filePath }),
        config,
      },
    );

    // #region test
    const schemas = await ops.getSchemas();
    const patchRes1 = await ops.createPatch(
      "/test/test1.val.js" as ModuleFilePath,
      [
        {
          op: "replace",
          path: ["testImage"],
          value: {
            _ref: "/public/val/images/smallest.png",
            _type: "file",
            metadata: {
              width: 8,
              height: 1,
              mimeType: "image/png",
            },
          },
        },
        {
          op: "file",
          filePath: "/public/val/images/smallest.png",
          path: ["testImage"],
          value: anotherSmallPng,
          remote: false,
        },
      ],
      {
        type: "head",
        headBaseSha: await ops.getBaseSha(),
      },
      null,
    );
    if (result.isErr(patchRes1)) {
      console.log("patch error", patchRes1.error);
      return;
    }
    console.log("patchRes1", patchRes1);
    const t0 = await ops.getSources();
    // console.log("base tree", JSON.stringify(t0, null, 2));
    // const v0 = await ops.validateSources(schemas, t0.sources);
    // console.log("base source validation", JSON.stringify(v0, null, 2));
    // const fv0 = await ops.validateFiles(schemas, t0.sources, v0.files);
    // console.log("base files validation", JSON.stringify(fv0, null, 2));
    const fp0 = await ops.fetchPatches({
      excludePatchOps: false,
    });
    console.log("found patches", JSON.stringify(fp0, null, 2));
    const patchesRes = await ops.fetchPatches({
      patchIds: Object.keys(fp0.patches) as PatchId[],
      excludePatchOps: false,
    });
    console.log("patches", patchesRes);
    const patchAnalysis = ops.analyzePatches(patchesRes.patches);
    const t1 = await ops.getSources({
      ...patchAnalysis,
      ...patchesRes,
    });
    console.log("patched tree", JSON.stringify(t1, null, 2));
    const v1 = await ops.validateSources(
      schemas,
      t1.sources,
      patchAnalysis.patchesByModule,
    );
    console.log("source validation", JSON.stringify(v1, null, 2));
    const fv1 = await ops.validateFiles(
      schemas,
      t1.sources,
      v1.files,
      patchAnalysis.fileLastUpdatedByPatchId,
    );
    console.log("files validation", JSON.stringify(fv1, null, 2));
    const pc1 = await ops.prepare({
      ...patchAnalysis,
      ...patchesRes,
    });
    console.log("prepare", JSON.stringify(pc1, null, 2));
    const s1 = await ops.saveOrUploadFiles(pc1, {
      pat: "test!",
    });
    console.log("save files", JSON.stringify(s1, null, 2));
    console.log(
      "found patches",
      JSON.stringify(
        await ops.fetchPatches({ excludePatchOps: false }),
        null,
        2,
      ),
    );
    if (result.isOk(patchRes1)) {
      await ops.createPatch(
        "/test/test1.val.js" as ModuleFilePath,
        [
          {
            op: "replace",
            path: ["testImage"],
            value: {
              _ref: "/public/val/images/smallest.png",
              _type: "file",
              metadata: {
                width: 8,
                height: 1,
                mimeType: "image/png",
              },
            },
          },
          {
            op: "file",
            filePath: "/public/val/images/smallest.png",
            path: ["testImage"],
            value: anotherSmallPng,
            remote: false,
          },
        ],
        {
          type: "patch",
          patchId: patchRes1.value.patchId,
        },
        null,
      );
    }
  });
});
