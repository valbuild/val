import { Internal, ModuleFilePath, PatchId, initVal } from "@valbuild/core";
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
  // Use the OS temp dir (NOT the repo-local ".tmp", which other suites wipe).
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-jsonvalues-test"));

  const evalModule = (code: string) =>
    new Script(
      transform(code, { transforms: ["imports"] }).code,
    ).runInNewContext({
      exports: {},
      require: (p: string) => {
        if (p === "val.config") {
          return { s, c, config };
        }
        // Resolve the `c.json(() => import("./x.val.json"))` thunks against the
        // module's directory in the TEMP root — plain `require` would resolve
        // them relative to this test file.
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

async function getSourcesWith(
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
  return ops.getSources({ ...analysis, patches });
}

/** Creates a real pending patch on disk, as the Studio would. */
async function createPatch(
  ops: ValOpsFS,
  patch: OrderedPatches["patches"][number]["patch"],
) {
  const existing = await ops.fetchPatches({ excludePatchOps: true });
  const last = existing.patches[existing.patches.length - 1];
  const res = await ops.createPatch(
    MODULE_PATH,
    patch,
    crypto.randomUUID() as PatchId,
    last
      ? { type: "patch", patchId: last.patchId }
      : { type: "head", headBaseSha: await ops.getBaseSha() },
    null,
    null,
  );
  if ("error" in res) {
    throw new Error(`Could not create patch: ${JSON.stringify(res)}`);
  }
  return res;
}

describe("ValOps.getJsonEntry", () => {
  test("returns the committed content when there are no patches", async () => {
    const { ops } = setup();
    const res = await ops.getJsonEntry(MODULE_PATH, "/blog/hello");
    expect(res).toEqual({
      status: "success",
      content: { title: "Hello", order: 1 },
    });
  });

  test("applies a pending content patch (the draft read path)", async () => {
    const { ops } = setup();
    await createPatch(ops, [
      { op: "replace", path: ["/blog/hello", "title"], value: "Draft!" },
    ]);
    const res = await ops.getJsonEntry(MODULE_PATH, "/blog/hello");
    expect(res).toEqual({
      status: "success",
      content: { title: "Draft!", order: 1 },
    });
  });

  test("applyPatches:false returns the committed content (what the Studio asks for)", async () => {
    const { ops } = setup();
    await createPatch(ops, [
      { op: "replace", path: ["/blog/hello", "title"], value: "Draft!" },
    ]);
    const res = await ops.getJsonEntry(MODULE_PATH, "/blog/hello", {
      applyPatches: false,
    });
    expect(res).toEqual({
      status: "success",
      content: { title: "Hello", order: 1 },
    });
  });

  test("resolves an entry that only exists in a pending patch", async () => {
    const { ops } = setup();
    await createPatch(ops, [
      { op: "add", path: ["/blog/new"], value: { title: "New", order: 3 } },
    ]);
    expect(await ops.getJsonEntry(MODULE_PATH, "/blog/new")).toEqual({
      status: "success",
      content: { title: "New", order: 3 },
    });
    // ...but not when the caller wants committed content only.
    expect(
      (
        await ops.getJsonEntry(MODULE_PATH, "/blog/new", {
          applyPatches: false,
        })
      ).status,
    ).toBe("not-found");
  });

  test("an entry removed by a pending patch is not-found", async () => {
    const { ops } = setup();
    await createPatch(ops, [{ op: "remove", path: ["/blog/world"] }]);
    expect((await ops.getJsonEntry(MODULE_PATH, "/blog/world")).status).toBe(
      "not-found",
    );
  });

  test("an unknown key is not-found", async () => {
    const { ops } = setup();
    expect((await ops.getJsonEntry(MODULE_PATH, "/nope")).status).toBe(
      "not-found",
    );
  });
});

describe("ValOps.getJsonEntries (batch)", () => {
  test("resolves many keys in one call", async () => {
    const { ops } = setup();
    const res = await ops.getJsonEntries(MODULE_PATH, {
      keys: ["/blog/hello", "/blog/world"],
    });
    expect(res).toEqual({
      status: "success",
      entries: [
        { key: "/blog/hello", content: { title: "Hello", order: 1 } },
        { key: "/blog/world", content: { title: "World", order: 2 } },
      ],
      missing: [],
      errors: [],
      total: 2,
    });
  });

  test("keeps the requested key order, and echoes it back", async () => {
    const { ops } = setup();
    const res = await ops.getJsonEntries(MODULE_PATH, {
      keys: ["/blog/world", "/blog/hello"],
    });
    expect(res.status === "success" && res.entries.map((e) => e.key)).toEqual([
      "/blog/world",
      "/blog/hello",
    ]);
  });

  test("an unknown key is `missing`, NOT a failed batch", async () => {
    const { ops } = setup();
    const res = await ops.getJsonEntries(MODULE_PATH, {
      keys: ["/blog/hello", "/nope"],
    });
    expect(res).toMatchObject({
      status: "success",
      entries: [{ key: "/blog/hello", content: { title: "Hello", order: 1 } }],
      missing: ["/nope"],
      errors: [],
    });
  });

  test("a corrupt entry is a per-key error, NOT a failed batch", async () => {
    const { ops, rootDir } = setup();
    fs.writeFileSync(
      path.join(rootDir, "test/content/world.val.json"),
      "{ not json",
      "utf-8",
    );
    const res = await ops.getJsonEntries(MODULE_PATH, {
      keys: ["/blog/hello", "/blog/world"],
    });
    expect(res.status).toBe("success");
    if (res.status !== "success") throw new Error("unreachable");
    expect(res.entries).toEqual([
      { key: "/blog/hello", content: { title: "Hello", order: 1 } },
    ]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].key).toBe("/blog/world");
  });

  test("applies pending patches per entry", async () => {
    const { ops } = setup();
    await createPatch(ops, [
      { op: "replace", path: ["/blog/hello", "title"], value: "Draft!" },
      { op: "remove", path: ["/blog/world"] },
    ]);
    const res = await ops.getJsonEntries(MODULE_PATH, {
      keys: ["/blog/hello", "/blog/world"],
    });
    expect(res).toMatchObject({
      status: "success",
      entries: [{ key: "/blog/hello", content: { title: "Draft!", order: 1 } }],
      missing: ["/blog/world"],
    });
  });

  test("offset/limit pages over the record in key order", async () => {
    const { ops } = setup();
    const first = await ops.getJsonEntries(
      MODULE_PATH,
      { offset: 0, limit: 1 },
      { applyPatches: false },
    );
    expect(first).toEqual({
      status: "success",
      entries: [{ key: "/blog/hello", content: { title: "Hello", order: 1 } }],
      missing: [],
      errors: [],
      offset: 0,
      limit: 1,
      total: 2,
    });
    const second = await ops.getJsonEntries(
      MODULE_PATH,
      { offset: 1, limit: 10 },
      { applyPatches: false },
    );
    expect(second).toMatchObject({
      status: "success",
      entries: [{ key: "/blog/world", content: { title: "World", order: 2 } }],
      offset: 1,
      limit: 10,
      total: 2,
    });
    // Past the end: empty, not an error.
    expect(
      await ops.getJsonEntries(
        MODULE_PATH,
        { offset: 5, limit: 10 },
        { applyPatches: false },
      ),
    ).toMatchObject({ status: "success", entries: [], total: 2 });
  });

  test("offset/limit is rejected when patches would be applied", async () => {
    const { ops } = setup();
    // The base key set cannot represent draft-added keys, so enumerating with
    // apply_patches would silently return a short list.
    const res = await ops.getJsonEntries(MODULE_PATH, { offset: 0, limit: 10 });
    expect(res.status).toBe("error");
  });

  test("an unknown module is not-found for the whole request", async () => {
    const { ops } = setup();
    expect(
      (
        await ops.getJsonEntries("/test/nope.val.ts" as ModuleFilePath, {
          keys: ["/blog/hello"],
        })
      ).status,
    ).toBe("not-found");
  });

  test("fetches patches ONCE for the whole batch", async () => {
    const { ops } = setup();
    await createPatch(ops, [
      { op: "replace", path: ["/blog/hello", "title"], value: "Draft!" },
    ]);
    const fetchPatches = jest.spyOn(ops, "fetchPatches");
    await ops.getJsonEntries(MODULE_PATH, {
      keys: ["/blog/hello", "/blog/world"],
    });
    expect(fetchPatches).toHaveBeenCalledTimes(1);
    fetchPatches.mockRestore();
  });
});

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

  test("move renames a hand-authored entry: relocates the file and swaps the thunk", async () => {
    const { ops } = setup();
    const pc = await prepareSingle(ops, [
      { op: "move", from: ["/blog/hello"], path: ["/blog/renamed"] },
    ]);
    expect(pc.hasErrors).toBe(false);
    // LOCKED convention: the destination uses the generated path, so a rename
    // relocates a hand-placed file out of its original directory.
    const newJson = pc.patchedSourceFiles["/test/pages/blog/renamed.val.json"];
    expect(typeof newJson).toBe("string");
    expect(JSON.parse(newJson as string)).toEqual({
      title: "Hello",
      order: 1,
    });
    expect(pc.patchedSourceFiles["/test/content/hello.val.json"]).toBeNull();
    const ts = pc.patchedSourceFiles[MODULE_PATH];
    expect(typeof ts).toBe("string");
    expect(ts).not.toContain(`"/blog/hello"`);
    expect(ts).not.toContain(`import("./content/hello.val.json")`);
    expect(ts).toContain(`"/blog/renamed"`);
    expect(ts).toContain(`import("./pages/blog/renamed.val.json")`);
    // the untouched entry survives
    expect(ts).toContain(`"/blog/world"`);
  });

  test("move then a content edit on the new key resolves to the new file", async () => {
    const { ops } = setup();
    const pc = await prepareSingle(ops, [
      { op: "move", from: ["/blog/hello"], path: ["/blog/renamed"] },
      { op: "replace", path: ["/blog/renamed", "title"], value: "Renamed!" },
    ]);
    expect(pc.hasErrors).toBe(false);
    const newJson = pc.patchedSourceFiles["/test/pages/blog/renamed.val.json"];
    expect(JSON.parse(newJson as string)).toEqual({
      title: "Renamed!",
      order: 1,
    });
    expect(pc.patchedSourceFiles["/test/content/hello.val.json"]).toBeNull();
  });

  test("a content edit on the OLD key after a move is an error", async () => {
    const { ops } = setup();
    const pc = await prepareSingle(ops, [
      { op: "move", from: ["/blog/hello"], path: ["/blog/renamed"] },
      { op: "replace", path: ["/blog/hello", "title"], value: "Nope" },
    ]);
    expect(pc.hasErrors).toBe(true);
  });

  test("copy duplicates an entry without deleting the source", async () => {
    const { ops } = setup();
    const pc = await prepareSingle(ops, [
      { op: "copy", from: ["/blog/hello"], path: ["/blog/copy"] },
    ]);
    expect(pc.hasErrors).toBe(false);
    const newJson = pc.patchedSourceFiles["/test/pages/blog/copy.val.json"];
    expect(JSON.parse(newJson as string)).toEqual({
      title: "Hello",
      order: 1,
    });
    // the source file is NOT deleted
    expect(
      pc.patchedSourceFiles["/test/content/hello.val.json"],
    ).not.toBeNull();
    const ts = pc.patchedSourceFiles[MODULE_PATH];
    expect(ts).toContain(`"/blog/hello"`);
    expect(ts).toContain(`"/blog/copy"`);
  });

  test("move from a non-entry path into an entry is an error", async () => {
    const { ops } = setup();
    const pc = await prepareSingle(ops, [
      // `from` targets a field INSIDE an entry, `path` targets a whole entry
      {
        op: "move",
        from: ["/blog/hello", "title"],
        path: ["/blog/renamed"],
      },
    ]);
    expect(pc.hasErrors).toBe(true);
  });

  test("a multi-op patch is applied exactly once (not once per op)", async () => {
    // Regression: analyzePatches used to push one entry per non-file op, so
    // `prepare` re-applied the whole patch once per op.
    const { ops } = setup();
    const pc = await prepareSingle(ops, [
      { op: "replace", path: ["/blog/hello", "order"], value: 10 },
      { op: "replace", path: ["/blog/world", "order"], value: 20 },
    ]);
    expect(pc.hasErrors).toBe(false);
    expect(
      JSON.parse(
        pc.patchedSourceFiles["/test/content/hello.val.json"] as string,
      ),
    ).toEqual({ title: "Hello", order: 10 });
    expect(
      JSON.parse(
        pc.patchedSourceFiles["/test/content/world.val.json"] as string,
      ),
    ).toEqual({ title: "World", order: 20 });
    expect(pc.appliedPatches[MODULE_PATH]).toHaveLength(1);
  });

  test("getSources: a content edit does not poison the module's patch chain", async () => {
    // Regression: getSources applied entry-content ops with jsonOps against the
    // opaque `{_type:"json"}` marker. That failed with "Cannot replace object
    // element which does not exist", after which EVERY later patch for the
    // module was skipped with "previous errors exists".
    const { ops } = setup();
    const res = await getSourcesWith(ops, [
      { op: "replace", path: ["/blog/hello", "title"], value: "Hello!" },
      { op: "add", path: ["/blog/new"], value: { title: "New", order: 3 } },
    ]);
    expect(res.errors[MODULE_PATH]).toBeUndefined();
    const source = res.sources[MODULE_PATH] as Record<string, unknown>;
    // Content edits leave the marker alone (content lives in the *.val.json).
    expect(Internal.isJson(source["/blog/hello"])).toBe(true);
    // A newly added entry appears as a marker, so the record's KEY SET is right.
    expect(Internal.isJson(source["/blog/new"])).toBe(true);
    expect(Object.keys(source).sort()).toEqual([
      "/blog/hello",
      "/blog/new",
      "/blog/world",
    ]);
  });

  test("getSources: a file op inside an entry leaves the module source alone", async () => {
    // The entry is an opaque marker in the module source, so the `patch_id`
    // injection for a drafted file has nowhere to go here — it goes into the
    // entry's own draft content. Reaching into the marker instead failed the op
    // and poisoned the rest of the module's patch chain, which is what made
    // uploading an image into a JSON entry impossible.
    const { ops } = setup();
    const res = await getSourcesWith(ops, [
      {
        op: "replace",
        path: ["/blog/hello", "hero"],
        value: { path: "/public/val/hero_a1b2c.png" },
      },
      {
        op: "file",
        path: ["/blog/hello", "hero"],
        filePath: "/public/val/hero_a1b2c.png",
        value: "data:image/png;base64,AAAA",
        remote: false,
      },
    ]);
    expect(res.errors[MODULE_PATH]).toBeUndefined();
    const source = res.sources[MODULE_PATH] as Record<string, unknown>;
    expect(Internal.isJson(source["/blog/hello"])).toBe(true);
  });

  test("getSources: remove and rename update the key set", async () => {
    const { ops } = setup();
    const res = await getSourcesWith(ops, [
      { op: "remove", path: ["/blog/world"] },
      { op: "move", from: ["/blog/hello"], path: ["/blog/renamed"] },
    ]);
    expect(res.errors[MODULE_PATH]).toBeUndefined();
    const source = res.sources[MODULE_PATH] as Record<string, unknown>;
    expect(Object.keys(source)).toEqual(["/blog/renamed"]);
    expect(Internal.isJson(source["/blog/renamed"])).toBe(true);
  });

  test("move between different entries' content is an error", async () => {
    const { ops } = setup();
    const pc = await prepareSingle(ops, [
      {
        op: "move",
        from: ["/blog/hello", "title"],
        path: ["/blog/world", "title"],
      },
    ]);
    expect(pc.hasErrors).toBe(true);
  });
});

/**
 * What the server serves as an entry's COMMITTED content after a save has just
 * written it.
 *
 * An entry's content is not in the module source — that holds a marker — so
 * `getJsonEntries` resolves it by awaiting the marker's own `import()`. That
 * caches, and unlike a module source there is nothing to re-extract, because the
 * memo was never holding the content in the first place. So once a publish
 * removes the patches, the committed baseline is the content from before the
 * publish, and both readers see it: a page rendering draft content
 * (`apply_patches: true`, with no patches left to replay) and the Studio, which
 * asks with `apply_patches: false` on purpose.
 *
 * This fixture models the staleness faithfully: the entry thunks go through a
 * `require` shim that caches by absolute path, so an entry resolved once keeps
 * answering the same way no matter what is written to disk afterwards.
 */
describe("adopting the entry content a save has written", () => {
  /** What `/save` does, in the order it does it. */
  const publish = async (
    ops: ValOpsFS,
    patch: OrderedPatches["patches"][number]["patch"],
    options?: { adopt?: boolean },
  ): Promise<void> => {
    await createPatch(ops, patch);
    const patches = await ops.fetchPatches({ excludePatchOps: false });
    const analysis = ops.analyzePatches(patches.patches);
    const prepared = await ops.prepare({ ...analysis, ...patches });
    expect(prepared.hasErrors).toBe(false);
    const saved = await ops.saveOrUploadFiles(prepared, "skip-remote");
    expect(saved.errors).toEqual({});
    if (options?.adopt !== false) {
      await ops.adoptCommittedSources({ ...analysis, ...patches }, prepared);
    }
    await ops.deletePatches(patches.patches.map((entry) => entry.patchId));
  };

  /**
   * Resolve the entry BEFORE publishing, which is what a rendered page does.
   *
   * Load-bearing, not scene-setting: it is what puts the entry in the `require`
   * cache, and therefore what makes the stale read reproducible at all. Publish
   * first and the thunk resolves after the write, so the test passes with or
   * without the adoption and asserts nothing.
   */
  const readFirst = async (ops: ValOpsFS, key: string): Promise<void> => {
    const res = await ops.getJsonEntry(MODULE_PATH, key);
    expect(res.status).toBe("success");
  };

  const entry = (ops: ValOpsFS, key: string) =>
    ops.getJsonEntry(MODULE_PATH, key);

  test("a content edit reads back as published", async () => {
    const { ops } = setup();
    await readFirst(ops, "/blog/hello");

    await publish(ops, [
      { op: "replace", path: ["/blog/hello", "title"], value: "Published!" },
    ]);

    expect(await ops.fetchPatches({ excludePatchOps: true })).toMatchObject({
      patches: [],
    });
    expect(await entry(ops, "/blog/hello")).toEqual({
      status: "success",
      content: { title: "Published!", order: 1 },
    });
  });

  /**
   * The same run without the adoption, so what it is for is on the record rather
   * than assumed: the file on disk is right and the answer is still the old one.
   */
  test("would answer with the pre-publish content without it", async () => {
    const { ops, rootDir } = setup();
    await readFirst(ops, "/blog/hello");

    await publish(
      ops,
      [{ op: "replace", path: ["/blog/hello", "title"], value: "Published!" }],
      { adopt: false },
    );

    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(rootDir, "/test/content/hello.val.json"),
          "utf-8",
        ),
      ),
    ).toEqual({ title: "Published!", order: 1 });
    expect(await entry(ops, "/blog/hello")).toEqual({
      status: "success",
      content: { title: "Hello", order: 1 },
    });
  });

  test("a whole-entry replace reads back as published", async () => {
    const { ops } = setup();
    await readFirst(ops, "/blog/hello");

    await publish(ops, [
      {
        op: "replace",
        path: ["/blog/hello"],
        value: { title: "Whole", order: 9 },
      },
    ]);

    expect(await entry(ops, "/blog/hello")).toEqual({
      status: "success",
      content: { title: "Whole", order: 9 },
    });
  });

  test("an added entry reads back as published", async () => {
    const { ops } = setup();
    await readFirst(ops, "/blog/hello");

    await publish(ops, [
      { op: "add", path: ["/blog/new"], value: { title: "New", order: 3 } },
    ]);

    expect(await entry(ops, "/blog/new")).toEqual({
      status: "success",
      content: { title: "New", order: 3 },
    });
  });

  test("a removed entry reads back as gone", async () => {
    const { ops } = setup();
    await readFirst(ops, "/blog/hello");

    await publish(ops, [{ op: "remove", path: ["/blog/hello"] }]);

    expect((await entry(ops, "/blog/hello")).status).toBe("not-found");
    // The untouched entry is unaffected.
    expect(await entry(ops, "/blog/world")).toEqual({
      status: "success",
      content: { title: "World", order: 2 },
    });
  });

  test("a moved entry reads back at its new key and not its old one", async () => {
    const { ops } = setup();
    await readFirst(ops, "/blog/hello");

    await publish(ops, [
      { op: "move", from: ["/blog/hello"], path: ["/blog/renamed"] },
    ]);

    expect((await entry(ops, "/blog/hello")).status).toBe("not-found");
    expect(await entry(ops, "/blog/renamed")).toEqual({
      status: "success",
      content: { title: "Hello", order: 1 },
    });
  });

  /**
   * The adopted value is the BASELINE, not the answer. A draft edit on top of a
   * published entry has to keep working — that is the whole read path this is
   * inside of.
   */
  test("a pending patch still applies on top of an adopted entry", async () => {
    const { ops } = setup();
    await readFirst(ops, "/blog/hello");
    await publish(ops, [
      { op: "replace", path: ["/blog/hello", "title"], value: "Published!" },
    ]);

    await createPatch(ops, [
      { op: "replace", path: ["/blog/hello", "title"], value: "Draft again" },
    ]);

    expect(await entry(ops, "/blog/hello")).toEqual({
      status: "success",
      content: { title: "Draft again", order: 1 },
    });
    // And the committed baseline underneath it is the published content.
    expect(
      await ops.getJsonEntry(MODULE_PATH, "/blog/hello", {
        applyPatches: false,
      }),
    ).toEqual({
      status: "success",
      content: { title: "Published!", order: 1 },
    });
  });
});
