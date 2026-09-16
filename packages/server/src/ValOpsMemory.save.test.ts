import {
  initVal,
  type ModuleFilePath,
  type PatchId,
  type ValModules,
} from "@valbuild/core";
import { ValOpsMemory } from "./ValOpsMemory";

const { s, c, config } = initVal();

const PATH = "/content/test.val.ts" as ModuleFilePath;

/** The file a patch is applied TO. `prepare()` rewrites this text's AST. */
const SOURCE = `import { s, c } from "../val.config";

export default c.define("/content/test.val.ts", s.object({
  title: s.string(),
  description: s.string(),
}), {
  title: "original title",
  description: "original description",
});
`;

const valModules: ValModules = {
  config,
  modules: [
    {
      def: () =>
        Promise.resolve({
          default: c.define(
            PATH,
            s.object({ title: s.string(), description: s.string() }),
            { title: "original title", description: "original description" },
          ),
        }),
    },
  ],
};

/**
 * What `/save` does, minus the HTTP.
 *
 * Deliberately the real sequence rather than a shortcut: the bug this pins
 * lives in the relationship between `prepare` (which READS the source file) and
 * `adoptCommittedSources` (which is the only thing that can move it), and a
 * test that called `prepare` twice without adopting in between would not have
 * seen it.
 */
async function save(ops: ValOpsMemory) {
  const patches = await ops.fetchPatches({ excludePatchOps: false });
  const analysis = ops.analyzePatches(patches.patches, patches.commits);
  const prepared = await ops.prepare({ ...analysis, ...patches });
  await ops.adoptCommittedSources({ ...analysis, ...patches }, prepared);
  await ops.deletePatches(patches.patches.map((p) => p.patchId));
  return prepared;
}

async function edit(ops: ValOpsMemory, field: string, value: string) {
  await ops.createPatch(
    PATH,
    [{ op: "replace", path: [field], value }],
    crypto.randomUUID() as PatchId,
    { type: "head", headBaseSha: await ops.getBaseSha() },
    null,
    null,
  );
}

describe("ValOpsMemory save", () => {
  test("a second save keeps what the first one wrote", async () => {
    /*
     * The regression, and it silently destroyed work.
     *
     * `getSourceFile` answers from what the host handed over at construction.
     * `fs` mode's equivalent is a disk that `saveOrUploadFiles` has just
     * rewritten, so the next `prepare()` reads the previous save's output. With
     * nothing moving the in-memory copy, the second save re-read the ORIGINAL
     * text, applied only its own patch to it, and produced a file that reverts
     * the first -- with no error anywhere, because applying a patch to the
     * original text succeeds perfectly well.
     *
     * The Studio auto-saves, so this is not an edge case. It is most of a
     * session's work.
     */
    const ops = new ValOpsMemory(valModules, {
      config,
      sourceFiles: { [PATH]: SOURCE },
    });

    await edit(ops, "title", "FIRST");
    const one = await save(ops);
    expect(one.patchedSourceFiles[PATH]).toContain("FIRST");

    await edit(ops, "description", "SECOND");
    const two = await save(ops);

    expect(two.patchedSourceFiles[PATH]).toContain("SECOND");
    expect(two.patchedSourceFiles[PATH]).toContain("FIRST");
    expect(two.patchedSourceFiles[PATH]).not.toContain("original title");
  });

  test("the same field edited twice keeps the later value", async () => {
    const ops = new ValOpsMemory(valModules, {
      config,
      sourceFiles: { [PATH]: SOURCE },
    });

    await edit(ops, "title", "ONE");
    await save(ops);
    await edit(ops, "title", "TWO");
    const two = await save(ops);

    expect(two.patchedSourceFiles[PATH]).toContain("TWO");
    expect(two.patchedSourceFiles[PATH]).not.toContain("ONE");
  });

  test("a host key without a leading slash is the same file Val commits to", async () => {
    // The host builds from `src/...`; Val asks and commits with `/src/...`.
    // Holding both spellings would let a save update one and leave the other as
    // the stale answer -- which is the same lost edit by another route.
    const ops = new ValOpsMemory(valModules, {
      config,
      sourceFiles: { "content/test.val.ts": SOURCE },
    });

    await edit(ops, "title", "FIRST");
    await save(ops);
    await edit(ops, "description", "SECOND");
    const two = await save(ops);

    expect(two.patchedSourceFiles[PATH]).toContain("FIRST");
    expect(two.patchedSourceFiles[PATH]).toContain("SECOND");
  });
});
