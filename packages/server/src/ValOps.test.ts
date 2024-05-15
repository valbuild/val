/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Internal,
  ModuleFilePath,
  PatchId,
  ValModules,
  initVal,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { bufferFromDataUrl, getMimeTypeFromBase64 } from "./ValServer";
import { Script } from "node:vm";
import { transform } from "sucrase";
import { GenericError, OpsMetadata, ValOps } from "./ValOps";
import { createMetadataFromBuffer } from "./ValOpsFS";

describe("ValServerOps", () => {
  test("flow", async () => {
    const smallPngBuffer = bufferFromDataUrl(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==",
      null
    );
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
        }).code
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

    // #region Test modules
    const fs: Record<string, string> = {
      "./test/test1.val.js": `
      import { s, c } from "val.config";
      
      export default c.define(
        "/test/test1.val.js",
        s.object({
          test: s.string().min(3),
          testImage: s.image(),
        }),
        {
          test: "Test 1 2 3",
          testImage: c.file("/public/test.png", {
            sha256:
              "80d58a5b775debc85386b320c347a59ffeeae5eeb3ca30a3a3ca04b5aaed145d",
            height: 12,
            width: 1,
            mimeType: "image/png",
          }),
        }
      );
      `,
      "./test/test2.val.js": `
      import { s, c } from "val.config";
      
      export default c.define(
        "/test/test2.val.js",
        s.object({
          test: s.string().min(30),
          testImage: s.image(),
        }),
        {
          test: "Test 1 2 3",
          testImage: c.file("/public/test.png", {
            sha256:
              "80d58a5b775debc85386b320c347a59ffeeae5eeb3ca30a3a3ca04b5aaed145d",
            height: 1,
            width: 1,
            mimeType: "image/png",
          }),
        }
      );
      `,
    };
    const fakeModules = Object.values(fs).map((code) => {
      return {
        def: async () => {
          return {
            default: evalModuleOnlyImportsValConfig(code),
          };
        },
      };
    });
    const ops = new MemoryValOps(
      {
        config,
        modules: fakeModules,
      },
      fs,
      {
        "/public/test.png": smallPngBuffer,
      }
    );
    const schemas = await ops.getSchemas();
    const patchRes1 = await ops.createPatch(
      "/test/test1.val.js" as ModuleFilePath,
      [
        {
          op: "replace",
          path: ["testImage"],
          value: {
            _ref: "/public/managed/images/smallest.png",
            _type: "file",
            metadata: {
              width: 8,
              height: 1,
              sha256:
                "a30094a4957f7ec5fb432c14eae0a0c178ab37bac55ef06ff8286ff087f01fd3",
              mimeType: "image/png",
            },
          },
        },
        {
          op: "file",
          filePath: "/public/managed/images/smallest.png",
          path: ["image"],
          value: anotherSmallPng,
        },
      ]
    );
    if (patchRes1.error) {
      console.log("patch error", patchRes1.error);
      return;
    }
    const patchId1 = patchRes1.patchId;
    const t0 = await ops.getTree();
    console.log("base tree", JSON.stringify(t0, null, 2));
    const v0 = await ops.validateSources(schemas, t0.sources);
    console.log("base source validation", JSON.stringify(v0, null, 2));
    const fv0 = await ops.validateFiles(schemas, t0.sources, v0.files);
    console.log("base files validation", JSON.stringify(fv0, null, 2));
    const patchAnalysis = ops.analyzePatches(
      await ops.getPatchesById([patchId1])
    );
    const t1 = await ops.getTree(patchAnalysis.patchesByModule);
    console.log("patched tree", JSON.stringify(t1, null, 2));
    const v1 = await ops.validateSources(
      schemas,
      t1.sources,
      patchAnalysis.patchesByModule
    );
    console.log("source validation", JSON.stringify(v1, null, 2));
    const fv1 = await ops.validateFiles(
      schemas,
      t1.sources,
      v1.files,
      patchAnalysis.fileLastUpdatedByPatchId
    );
    console.log("files validation", JSON.stringify(fv1, null, 2));
    const pc1 = await ops.prepareCommit(patchAnalysis);
    console.log("prepare commit", JSON.stringify(pc1, null, 2));
  });
});

// #region MemoryValOps
class MemoryValOps extends ValOps {
  patches: {
    [patchId: PatchId]: {
      path: ModuleFilePath;
      patch: Patch;
      created_at: string;
    };
  } = {};
  patchFiles: {
    [patchId: PatchId]: Record<string, { data: string; sha256: string }>;
  } = {};
  patchIdCounter = 1;
  constructor(
    valModules: ValModules,
    private readonly sourceFiles: { [path: string]: string },
    private readonly files: {
      [filePath: string]: Buffer;
    } = {}
  ) {
    super(valModules);
  }

  async getPatchesById(patchIds: PatchId[]): Promise<{
    [patchId: PatchId]: {
      path: ModuleFilePath;
      patch: Patch;
      created_at: string;
    };
  }> {
    const res: {
      [patchId: PatchId]: {
        path: ModuleFilePath;
        patch: Patch;
        created_at: string;
      };
    } = {};
    for (const patchId of patchIds) {
      res[patchId] = this.patches[patchId];
    }
    return res;
  }

  protected async getPatchBase64FileMetadata(
    filePath: string,
    type: "file" | "image",
    fields: string[],
    patchId: PatchId
  ): Promise<OpsMetadata> {
    const patchedFiles = this.patchFiles[patchId];
    if (!patchedFiles) {
      console.error(this.patchFiles);
      return {
        metadata: {},
        errors: [
          {
            message: `No files found for patch id '${patchId}'`,
            filePath,
          },
        ],
      };
    }
    const patchedFile = patchedFiles[filePath];
    if (!patchedFile) {
      return {
        metadata: {},
        errors: [{ message: "File not found", filePath }],
      };
    }
    const buffer = bufferFromDataUrl(patchedFile.data, null);
    if (!buffer) {
      return {
        metadata: {},
        errors: [
          {
            message: "Could not create buffer from data url",
            filePath,
          },
        ],
      };
    }
    return createMetadataFromBuffer(
      filePath,
      type,
      fields,
      buffer,
      patchedFile.data
    );
  }

  protected async getBinaryFileMetadata(
    filePath: string,
    type: "file" | "image",
    fields: string[]
  ): Promise<OpsMetadata> {
    const buffer = this.files[filePath];
    if (!buffer) {
      return {
        metadata: {},
        errors: [{ message: "File not found", filePath }],
      };
    }
    return createMetadataFromBuffer(filePath, type, fields, buffer);
  }
  protected async saveSourceFilePatch(
    path: ModuleFilePath,
    patch: Patch
  ): Promise<{ patchId: PatchId; error?: undefined } | GenericError> {
    const patchId = (this.patchIdCounter++).toString() as PatchId;
    this.patches[patchId] = {
      path,
      patch,
      created_at: new Date().toISOString(),
    };
    return { patchId };
  }
  protected async getSourceFile(
    path: ModuleFilePath
  ): Promise<{ data: string; error?: undefined } | GenericError> {
    const foundFile = this.sourceFiles[`.${path}`] ?? null;
    if (!foundFile) {
      return { error: { message: "File not found" } };
    }
    return { data: foundFile };
  }
  protected async savePatchBase64File(
    filePath: string,
    patchId: PatchId,
    data: string,
    sha256: string
  ): Promise<
    { patchId: PatchId; filePath: string; error?: undefined } | GenericError
  > {
    if (!this.patchFiles[patchId]) {
      this.patchFiles[patchId] = {};
    }
    if (this.patchFiles[patchId][filePath]) {
      return { error: { message: "File already exists" } };
    }
    this.patchFiles[patchId][filePath] = { data, sha256 };
    return {
      patchId,
      filePath,
    };
  }
}
