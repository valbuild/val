/* eslint-disable @typescript-eslint/no-unused-vars */
import { ModuleFilePath, PatchId, initVal } from "@valbuild/core";
import { Script } from "node:vm";
import { transform } from "sucrase";
import fs from "fs";
import path from "node:path";
import prettier from "prettier";
import { ValOpsHttp } from "./ValOpsHttp";
import { AuthorId, CommitSha } from "./ValOps";

describe("ValOpsFS", () => {
  test("flow", async () => {
    // #region test setup
    const { s, c, config } = initVal();
    /**
     * Eval modules that only imports val.config (to make things easier)
     * Only useful for basic tests
     */
    const evalModuleOnlyImportsValConfig = (code: string) => {
      const res = new Script(
        transform(code, {
          transforms: ["imports", "typescript"],
        }).code
      ).runInNewContext({
        exports: {},
        require: (path: string) => {
          if (path === "../val.config") {
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
      "/components/clientContent.val.ts": prettier.format(
        `
        import { s, c, type t } from "../val.config";

        export const schema = s.object({
          text: s.string(),
          objectUnions: s.union(
            "type",
            s.object({
              type: s.literal("object-type-1"),
              value: s.number(),
            }),
            s.object({
              type: s.literal("object-type-2"),
              value: s.string(),
            })
          ),
          arrays: s.array(s.string()),
          stringEnum: s.union(
            s.literal("lit-0"),
            s.literal("lit-1"),
            s.literal("lit-2")
          ),
        });
        export type ClientContent = t.inferSchema<typeof schema>;
        
        export default c.define("/components/clientContent.val.ts", schema, {
          text: "Client components works",
          objectUnions: {
            type: "object-type-2",
            value: "You can have multiple different types in a union",
          },
          arrays: ["array-1", "array-2"],
          stringEnum: "lit-1",
        });
        
      `,
        { parser: "typescript" }
      ),
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

    const hostUrl = process.env.TEST_VAL_BUILD_URL;
    const project = process.env.TEST_VAL_PROJECT;
    const commitSha = process.env.TEST_VAL_COMMIT as CommitSha;
    const branch = process.env.TEST_VAL_BRANCH;
    const apiKey = process.env.TEST_VAL_API_KEY;
    const authorId = process.env.TEST_VAL_AUTHOR_ID as AuthorId;
    if (!hostUrl || !project || !commitSha || !branch || !apiKey || !authorId) {
      console.log(
        "Test is skipped! Set:\n\tTEST_VAL_BUILD_URL\n\tTEST_VAL_PROJECT\n\tTEST_VAL_COMMIT\n\tTEST_VAL_BRANCH\n\tTEST_VAL_API_KEY\n\tTEST_VAL_AUTHOR_ID\nto run test (note .env files are not setup)"
      );
      return;
    }

    const ops = new ValOpsHttp(
      hostUrl,
      project,
      commitSha,
      branch,
      apiKey,
      {
        config,
        modules: fakeModules,
      },
      {
        root: "/examples/next",
        formatter: (code, filePath) =>
          prettier.format(code, { filepath: filePath }),
      }
    );

    // #region test

    const allPatchesOnBranch = await ops.fetchPatches({ omitPatch: false });
    const cleanupPatches = await ops.deletePatches(
      Object.keys(allPatchesOnBranch.patches) as PatchId[]
    );
    console.log("cleanupPatches", cleanupPatches);

    const schemas = await ops.getSchemas();
    const patchRes1 = await ops.createPatch(
      "/components/clientContent.val.ts" as ModuleFilePath,
      [
        {
          op: "replace",
          path: ["text"],
          value: "Http works",
        },
      ],
      authorId
    );
    if (patchRes1.error) {
      console.log("patch error", patchRes1.error);
      return;
    }
    console.log("patchRes1", JSON.stringify(patchRes1, null, 2));
    const t0 = await ops.getTree();
    // console.log("base tree", JSON.stringify(t0, null, 2));
    // const v0 = await ops.validateSources(schemas, t0.sources);
    // console.log("base source validation", JSON.stringify(v0, null, 2));
    // const fv0 = await ops.validateFiles(schemas, t0.sources, v0.files);
    // console.log("base files validation", JSON.stringify(fv0, null, 2));
    const fp0 = await ops.fetchPatches({ omitPatch: false });
    console.log("found patches", JSON.stringify(fp0, null, 2));
    const patchesRes = await ops.fetchPatches({
      patchIds: Object.keys(fp0.patches) as PatchId[],
      omitPatch: false,
    });
    console.log("patches", patchesRes);
    const patchAnalysis = ops.analyzePatches(patchesRes.patches);
    const t1 = await ops.getTree({
      ...patchAnalysis,
      ...patchesRes,
    });
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
    const pc1 = await ops.prepare({
      ...patchAnalysis,
      ...patchesRes,
    });
    console.log("prepare", JSON.stringify(pc1, null, 2));
    const c1 = await ops.commit(pc1, "message", authorId, "test-branch");
    console.log("commit", JSON.stringify(c1, null, 2));
    console.log(
      "found patches",
      JSON.stringify(await ops.fetchPatches({ omitPatch: false }), null, 2)
    );
  });
});
