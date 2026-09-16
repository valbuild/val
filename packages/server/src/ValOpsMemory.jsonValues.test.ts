import { ModuleFilePath, PatchId, initVal } from "@valbuild/core";
import { Script } from "node:vm";
import { transform } from "sucrase";
import fs from "fs";
import os from "node:os";
import path from "node:path";
import { ValOpsMemory } from "./ValOpsMemory";

/**
 * The OTHER kind of content, put through the same test that caught the first
 * lost-edit bug.
 *
 * A `.jsonValues()` entry's content is NOT in its module's source -- the source
 * holds a marker, and the content is resolved by awaiting the marker's own
 * `import()`. So `adoptPatchedSourceFiles`, which fixed this for `.val.ts`
 * text, cannot be what makes a second save see the first here: the read never
 * goes through `getSourceFile`.
 *
 * What should cover it is `adoptedJsonEntries` on the BASE class, fed by
 * `adoptCommittedSources`. That is reasoning, and reasoning is exactly what was
 * wrong the first time -- the `.val.ts` case also looked fine until it was run.
 * So it is run.
 */
const MODULE_PATH = "/test/pages.val.ts" as ModuleFilePath;

const MODULE_CODE = `
import { s, c } from "val.config";

export default c.define(
  "/test/pages.val.ts",
  s.record(s.object({ title: s.string(), order: s.number() })).jsonValues(),
  {
    "/blog/hello": c.json(() => import("./content/hello.val.json")),
    "/blog/world": c.json(() => import("./content/world.val.json")),
  }
);
`;

const JSON_FILES: Record<string, unknown> = {
  "/test/content/hello.val.json": { title: "Hello", order: 1 },
  "/test/content/world.val.json": { title: "World", order: 2 },
};

function setup() {
  const { s, c, config } = initVal();
  // A temp dir even though this mode has no filesystem: the `c.json(() =>
  // import(...))` thunks resolve through the HOST's module system, which here
  // is node's. In the isolate it is the bundled app. Either way it is not
  // `sourceFiles`, which is the point being tested.
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "val-memory-jsonvalues"),
  );

  const evalModule = (code: string) =>
    new Script(
      transform(code, { transforms: ["imports"] }).code,
    ).runInNewContext({
      exports: {},
      require: (p: string) => {
        if (p === "val.config") return { s, c, config };
        if (p.startsWith("./") || p.startsWith("../")) {
          const abs = path.resolve(
            path.join(rootDir, path.dirname(MODULE_PATH)),
            p,
          );
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return require(abs);
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(p);
      },
      module: { exports: {} },
    });

  for (const [filePath, content] of Object.entries(JSON_FILES)) {
    const absPath = path.join(rootDir, filePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, JSON.stringify(content, null, 2));
  }

  const ops = new ValOpsMemory(
    {
      config,
      modules: [{ def: async () => ({ default: evalModule(MODULE_CODE) }) }],
    },
    {
      config,
      sourceFiles: {
        [MODULE_PATH]: MODULE_CODE,
        /*
         * The finding this test produced.
         *
         * Applying a patch to an entry READS its `.val.json` through
         * `getSourceFile`, even though reading one for display goes through the
         * marker's `import()`. So a host that ships only code ships a project
         * whose entry content cannot be edited at all -- the save fails with
         * "File not found" and nothing else says why.
         *
         * The platform's `readSources` collected only `.tsx?|jsx?|mjs|cjs`
         * until this ran.
         */
        ...Object.fromEntries(
          Object.entries(JSON_FILES).map(([filePath, content]) => [
            filePath,
            JSON.stringify(content, null, 2),
          ]),
        ),
      },
    },
  );
  return { ops, rootDir };
}

/** `/save`, minus the HTTP. Same sequence as ValOpsMemory.save.test.ts. */
async function save(ops: ValOpsMemory) {
  const patches = await ops.fetchPatches({ excludePatchOps: false });
  const analysis = ops.analyzePatches(patches.patches, patches.commits);
  const prepared = await ops.prepare({ ...analysis, ...patches });
  await ops.adoptCommittedSources({ ...analysis, ...patches }, prepared);
  await ops.deletePatches(patches.patches.map((p) => p.patchId));
  return prepared;
}

async function edit(
  ops: ValOpsMemory,
  entry: string,
  field: string,
  value: unknown,
) {
  await ops.createPatch(
    MODULE_PATH,
    [{ op: "replace", path: [entry, field], value } as never],
    crypto.randomUUID() as PatchId,
    { type: "head", headBaseSha: await ops.getBaseSha() },
    null,
    null,
  );
}

describe("ValOpsMemory jsonValues entries", () => {
  test("a second save keeps what the first one wrote to another entry", async () => {
    const { ops, rootDir } = setup();
    try {
      await edit(ops, "/blog/hello", "title", "FIRST");
      const one = await save(ops);
      expect(JSON.stringify(one.patchedJsonEntries)).toContain("FIRST");

      await edit(ops, "/blog/world", "title", "SECOND");
      const two = await save(ops);

      // The read that matters: what the server now believes each entry holds.
      // If the second save recomputed from the module's ORIGINAL import, the
      // first entry is back to "Hello" and an edit was lost silently.
      // COMMITTED content, per entry: what the server believes is published,
      // with no pending patches in play. Both saves have landed, so both edits
      // must be here.
      const hello = await ops.getJsonEntry(MODULE_PATH, "/blog/hello", {
        applyPatches: false,
      });
      const world = await ops.getJsonEntry(MODULE_PATH, "/blog/world", {
        applyPatches: false,
      });
      expect(JSON.stringify(world)).toContain("SECOND");
      expect(JSON.stringify(hello)).toContain("FIRST");
      expect(JSON.stringify(hello)).not.toContain("Hello");
      expect(JSON.stringify(two.patchedJsonEntries)).toContain("SECOND");
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
