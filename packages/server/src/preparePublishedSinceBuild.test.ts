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

const MODULE_PATH = "/test/authors.val.js" as ModuleFilePath;

const { s, c, config } = initVal();

/**
 * A publish patches the BUILD's text, so what was published since the build
 * has to be replayed over it first.
 *
 * In http mode a published patch stays in the chain, with `appliedAt` set,
 * until a deployment moves the base past it. A publish commits only what is
 * still pending, so patching the build's text with that alone wrote a commit
 * that reverted every change published since: two publishes into one file
 * before the site redeployed, and the second undid the first. That is
 * `e2e/http/publish.spec.ts`, "a second change publishes on top of the first
 * commit", end to end; this is the same thing at `prepare`.
 *
 * `fs` mode never marks a patch applied (publishing rewrites the working
 * tree), so the chain content would send is made here by marking the first
 * of two patches as published -- the one edge faked.
 */
describe("prepare over changes published since the build", () => {
  const createProject = async () => {
    const code = synchronizedPrettier.format(
      `
      import { s, c } from "val.config";

      export default c.define(
        "${MODULE_PATH}",
        s.object({ name: s.string(), title: s.string() }),
        { name: "Before", title: "Before" },
      );
      `,
      { filepath: "test.val.ts" },
    );
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "prepare-since-"));
    const absPath = path.join(rootDir, MODULE_PATH);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, code);
    const ops = new ValOpsFS(
      process.env.VAL_CONTENT_URL || "http://localhost:4000",
      rootDir,
      {
        config,
        modules: [
          {
            def: async () => ({
              default: new Script(
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
              }),
            }),
          },
        ],
      },
      {
        formatter: (text, filePath) =>
          synchronizedPrettier.format(text, { filepath: filePath }),
        config,
      },
    );
    const patchIds: PatchId[] = [];
    const addPatch = async (patch: Parameters<typeof ops.createPatch>[1]) => {
      const patchId = crypto.randomUUID() as PatchId;
      const parentRef =
        patchIds.length === 0
          ? ({ type: "head", headBaseSha: await ops.getBaseSha() } as const)
          : ({
              type: "patch",
              patchId: patchIds[patchIds.length - 1],
            } as const);
      const res = await ops.createPatch(
        MODULE_PATH,
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
    /** The chain as content sends it: `published` carry `appliedAt`. */
    const analyse = async (published: Set<PatchId>) => {
      const fetched = await ops.fetchPatches({ excludePatchOps: false });
      const chain: OrderedPatches = {
        ...fetched,
        patches: fetched.patches.map((patch) =>
          published.has(patch.patchId)
            ? { ...patch, appliedAt: { commitSha: "valcommit1" } }
            : patch,
        ),
      };
      const analysis: PatchAnalysis & OrderedPatches = {
        ...ops.analyzePatches(chain.patches),
        ...chain,
      };
      return analysis;
    };
    return { ops, addPatch, analyse };
  };

  test("the publish keeps what was published before it, and commits only its own change", async () => {
    const { ops, addPatch, analyse } = await createProject();
    const first = await addPatch([
      { op: "replace", path: ["name"], value: "First value" },
    ]);
    const second = await addPatch([
      { op: "replace", path: ["title"], value: "Second value" },
    ]);

    const prepared = await ops.prepare(await analyse(new Set([first])));

    expect(prepared.hasErrors).toBe(false);
    const text = prepared.patchedSourceFiles[MODULE_PATH];
    expect(text).toContain("First value");
    expect(text).toContain("Second value");
    expect(text).not.toContain("Before");
    // The first is replayed, not published again.
    expect(prepared.appliedPatches[MODULE_PATH]).toEqual([second]);
  });

  test("a published change that no longer applies stops the publish rather than being reverted", async () => {
    const { ops, addPatch, analyse } = await createProject();
    const first = await addPatch([
      { op: "replace", path: ["name"], value: "First value" },
    ]);
    const second = await addPatch([
      { op: "replace", path: ["title"], value: "Second value" },
    ]);
    const analysis = await analyse(new Set([first]));
    // As if the build's text had no `name` for the published change to replace.
    const broken: PatchAnalysis & OrderedPatches = {
      ...analysis,
      patches: analysis.patches.map((patch) =>
        patch.patchId === first
          ? {
              ...patch,
              patch: [{ op: "replace", path: ["missing"], value: "x" }],
            }
          : patch,
      ),
    };

    const prepared = await ops.prepare(broken, { continueOnError: true });

    expect(prepared.hasErrors).toBe(true);
    expect(prepared.patchedSourceFiles[MODULE_PATH]).toBeUndefined();
    // Not the editor's change, so not offered for removal; theirs is untried.
    expect(Object.keys(prepared.unappliablePatches)).toEqual([]);
    expect(prepared.appliedPatches[MODULE_PATH] ?? []).toEqual([]);
    expect(JSON.stringify(prepared.sourceFilePatchErrors)).toContain(
      "would revert it",
    );
    expect(second).toBeDefined();
  });
});
