import { ModuleFilePath, PatchId, initVal } from "@valbuild/core";
import { Script } from "node:vm";
import { transform } from "sucrase";
import { ValOpsFS } from "./ValOpsFS";
import fs from "fs";
import os from "node:os";
import path from "node:path";
import synchronizedPrettier from "@prettier/sync";
import type { OrderedPatches } from "./ValOps";

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
  const evalModule = (code: string) =>
    new Script(
      transform(code, { transforms: ["imports"] }).code,
    ).runInNewContext({
      exports: {},
      require: (p: string) => {
        if (p === "val.config") {
          return { s, c, config };
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(p);
      },
      module: { exports: {} },
    });

  // Use the OS temp dir (NOT the repo-local ".tmp", which other suites wipe).
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-jsonvalues-test"));

  const moduleAbs = path.join(rootDir, MODULE_PATH);
  fs.mkdirSync(path.dirname(moduleAbs), { recursive: true });
  fs.writeFileSync(
    moduleAbs,
    synchronizedPrettier.format(MODULE_CODE, { parser: "typescript" }),
  );
  for (const [filePath, content] of Object.entries(JSON_FILES)) {
    const absPath = path.join(rootDir, filePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, JSON.stringify(content, null, 2));
  }

  const contentHost = process.env.VAL_CONTENT_URL || "http://localhost:4000";
  const ops = new ValOpsFS(
    contentHost,
    rootDir,
    {
      config,
      modules: [{ def: async () => ({ default: evalModule(MODULE_CODE) }) }],
    },
    {
      formatter: (code, filePath) =>
        synchronizedPrettier.format(code, { filepath: filePath }),
      config,
    },
  );
  return { ops, rootDir };
}

async function prepareSingle(
  ops: ValOpsFS,
  patch: OrderedPatches["patches"][number]["patch"],
) {
  const patches: OrderedPatches["patches"] = [
    {
      path: MODULE_PATH,
      patchId: crypto.randomUUID() as PatchId,
      patch,
      createdAt: new Date().toISOString(),
      authorId: null,
      baseSha: await ops.getBaseSha(),
      appliedAt: null,
    },
  ];
  const analysis = ops.analyzePatches(patches);
  return ops.prepare({ ...analysis, patches });
}

describe("ValOpsFS jsonValues commit flow", () => {
  test("content edit writes only the *.val.json (not the .val.ts)", async () => {
    const { ops } = setup();
    const pc = await prepareSingle(ops, [
      { op: "replace", path: ["/blog/hello", "title"], value: "Hello!" },
    ]);
    expect(pc.hasErrors).toBe(false);
    // .val.ts is untouched on a pure content edit
    expect(pc.patchedSourceFiles[MODULE_PATH]).toBeUndefined();
    const written = pc.patchedSourceFiles["/test/content/hello.val.json"];
    expect(typeof written).toBe("string");
    expect(JSON.parse(written as string)).toEqual({
      title: "Hello!",
      order: 1,
    });
    // the untouched entry is not written
    expect(
      pc.patchedSourceFiles["/test/content/world.val.json"],
    ).toBeUndefined();
  });

  test("add entry writes a new *.val.json and inserts a c.json thunk", async () => {
    const { ops } = setup();
    const pc = await prepareSingle(ops, [
      {
        op: "add",
        path: ["/blog/new"],
        value: { title: "New", order: 3 },
      },
    ]);
    expect(pc.hasErrors).toBe(false);
    const newJson = pc.patchedSourceFiles["/test/pages/blog/new.val.json"];
    expect(typeof newJson).toBe("string");
    expect(JSON.parse(newJson as string)).toEqual({ title: "New", order: 3 });
    const ts = pc.patchedSourceFiles[MODULE_PATH];
    expect(typeof ts).toBe("string");
    expect(ts).toContain(`import("./pages/blog/new.val.json")`);
    expect(ts).toContain(`"/blog/new"`);
  });

  test("remove entry deletes the *.val.json and drops the thunk", async () => {
    const { ops } = setup();
    const pc = await prepareSingle(ops, [
      { op: "remove", path: ["/blog/world"] },
    ]);
    expect(pc.hasErrors).toBe(false);
    // null signals a file deletion in the commit loop
    expect(pc.patchedSourceFiles["/test/content/world.val.json"]).toBeNull();
    const ts = pc.patchedSourceFiles[MODULE_PATH];
    expect(typeof ts).toBe("string");
    expect(ts).not.toContain(`"/blog/world"`);
    expect(ts).toContain(`"/blog/hello"`);
  });
});
