import { Internal, ModuleFilePath, PatchId, initVal } from "@valbuild/core";
import { Script } from "node:vm";
import { transform } from "sucrase";
import { ValOpsFS } from "./ValOpsFS";
import fs from "fs";
import os from "node:os";
import path from "node:path";
import synchronizedPrettier from "@prettier/sync";
import type { OrderedPatches } from "./ValOps";
import {
  defineExternal,
  ok,
  type ExternalRecords,
  type ExternalKeyPage,
  type Returns,
} from "./externalRecords";

/**
 * External records end to end at the `ValOps` layer: a real module on disk, real
 * pending patches in a real patch store, and a fake adapter standing in for a
 * database.
 *
 * This is where the three storage modes have to become indistinguishable to a
 * reader, so most of what is asserted here is a comparison with what
 * `.jsonValues()` would have done.
 */

const MODULE_PATH = "/test/products.val.ts" as ModuleFilePath;

const MODULE_CODE = `
import { s, c } from "val.config";

export default c.define(
  "/test/products.val.ts",
  s.record(s.object({ title: s.string(), price: s.number() })).external("products"),
  c.external()
);
`;

/** A module whose entries were pasted in rather than moved to the store. */
const INLINE_MODULE_CODE = `
import { s, c } from "val.config";

export default c.define(
  "/test/products.val.ts",
  s.record(s.object({ title: s.string(), price: s.number() })).external("products"),
  { "written-inline": { title: "Inline", price: 1 } }
);
`;

type Row = { title: string; price: number };

type StoreCalls = {
  keys: { cursor: string | null; limit: number }[];
  get: string[][];
  transactions: number;
};

function fakeStore(
  rows: Record<string, Row>,
  opts: {
    maxPageSize?: number;
    maxBatchSize?: number;
    withAround?: boolean;
    search?: false;
    count?: false;
  } = {},
): { records: ExternalRecords; calls: StoreCalls; module: unknown } {
  const calls: StoreCalls = { keys: [], get: [], transactions: 0 };
  const { s, c } = initVal();
  const module = c.define(
    "/test/products.val.ts",
    s
      .record(s.object({ title: s.string(), price: s.number() }))
      .external("products"),
    c.external(),
  );
  const listKeys = async (args: {
    cursor: string | null;
    limit: number;
  }): Promise<Returns<ExternalKeyPage>> => {
    calls.keys.push({ cursor: args.cursor, limit: args.limit });
    const all = Object.keys(rows);
    const from = args.cursor === null ? 0 : Number(args.cursor);
    const page = all.slice(from, from + args.limit);
    const next = from + page.length;
    return ok({ keys: page, cursor: next >= all.length ? null : String(next) });
  };
  const { entry, modules } = opts.withAround
    ? defineExternal<{ id: number }>({
        around: async (run) => {
          calls.transactions++;
          return run({ id: calls.transactions });
        },
      })
    : defineExternal();
  const records = modules({
    products: entry(module, {
      keys: listKeys,
      get: async (keys) => {
        calls.get.push(keys);
        const out: Record<string, Row | null> = {};
        for (const key of keys) {
          out[key] = rows[key] ?? null;
        }
        return ok(out);
      },
      put: async () => ok(undefined),
      delete: async () => ok(undefined),
      ...(opts.search !== undefined ? { search: opts.search } : {}),
      ...(opts.count !== undefined ? { count: opts.count } : {}),
      ...(opts.maxPageSize !== undefined
        ? { maxPageSize: opts.maxPageSize }
        : {}),
      ...(opts.maxBatchSize !== undefined
        ? { maxBatchSize: opts.maxBatchSize }
        : {}),
    }),
  });
  return { records, calls, module };
}

function setup(
  rows: Record<string, Row>,
  opts: Parameters<typeof fakeStore>[1] & { inline?: boolean } = {},
) {
  const { s, c, config } = initVal();
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-external-test"));
  const code = opts.inline ? INLINE_MODULE_CODE : MODULE_CODE;

  const evalModule = (source: string) =>
    new Script(
      transform(source, { transforms: ["imports"] }).code,
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

  const moduleAbs = path.join(rootDir, MODULE_PATH);
  fs.mkdirSync(path.dirname(moduleAbs), { recursive: true });
  fs.writeFileSync(
    moduleAbs,
    synchronizedPrettier.format(code, { parser: "typescript" }),
  );

  const { records, calls } = fakeStore(rows, opts);
  const ops = new ValOpsFS(
    process.env.VAL_CONTENT_URL || "http://localhost:4000",
    rootDir,
    {
      config,
      modules: [{ def: async () => ({ default: evalModule(code) }) }],
    },
    {
      formatter: (c2, filePath) =>
        synchronizedPrettier.format(c2, { filepath: filePath }),
      config,
      external: records,
    },
  );
  return { ops, calls, rootDir };
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

const ROWS: Record<string, Row> = {
  a: { title: "Anvil", price: 10 },
  b: { title: "Bucket", price: 20 },
  c: { title: "Crate", price: 30 },
};

describe("reading an external record", () => {
  test("keys come back paged, with a total", async () => {
    const { ops } = setup(ROWS);
    const res = await ops.getExternalKeys(MODULE_PATH, {
      cursor: null,
      limit: 2,
    });
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.keys).toEqual(["a", "b"]);
    expect(res.cursor).toBe("2");
  });

  test("entries come back in the same shape a .jsonValues() record uses", async () => {
    // The point of the whole design: a reader must not be able to tell how a
    // record is stored.
    const { ops } = setup(ROWS);
    const res = await ops.getExternalEntries(MODULE_PATH, ["a", "zz"]);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.entries).toEqual([
      { key: "a", content: { title: "Anvil", price: 10 } },
    ]);
    expect(res.missing).toEqual(["zz"]);
    expect(res.errors).toEqual([]);
  });

  test("fifty keys are ONE adapter call, and one transaction", async () => {
    const rows: Record<string, Row> = {};
    for (let i = 0; i < 50; i++) {
      rows[`k${i}`] = { title: `T${i}`, price: i };
    }
    const { ops, calls } = setup(rows, { withAround: true });
    const res = await ops.getExternalEntries(MODULE_PATH, Object.keys(rows));
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.entries).toHaveLength(50);
    expect(calls.get).toHaveLength(1);
    expect(calls.transactions).toBe(1);
  });

  test("a store that only serves ten at a time still answers fifty, in one transaction", async () => {
    const rows: Record<string, Row> = {};
    for (let i = 0; i < 50; i++) {
      rows[`k${i}`] = { title: `T${i}`, price: i };
    }
    const { ops, calls } = setup(rows, {
      withAround: true,
      maxBatchSize: 10,
    });
    const res = await ops.getExternalEntries(MODULE_PATH, Object.keys(rows));
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.entries).toHaveLength(50);
    expect(calls.get).toHaveLength(5);
    // Five calls, one scope: chunking must not turn into five transactions.
    expect(calls.transactions).toBe(1);
  });

  test("an unbound module is not-found, not an empty record", async () => {
    const { ops } = setup(ROWS);
    const res = await ops.getExternalKeys("/nope.val.ts" as ModuleFilePath, {
      cursor: null,
      limit: 10,
    });
    expect(res.status).toBe("not-found");
  });
});

describe("unpublished edits are visible", () => {
  test("an edit inside an entry is applied over the store's content", async () => {
    const { ops } = setup(ROWS);
    await createPatch(ops, [
      { op: "replace", path: ["a", "title"], value: "Anvil, revised" },
    ]);
    const res = await ops.getExternalEntries(MODULE_PATH, ["a"]);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.entries[0].content).toEqual({
      title: "Anvil, revised",
      price: 10,
    });
  });

  test("a draft-added key appears in the key list and resolves", async () => {
    const { ops } = setup(ROWS);
    await createPatch(ops, [
      { op: "add", path: ["d"], value: { title: "Drum", price: 40 } },
    ]);
    const keys = await ops.getExternalKeys(MODULE_PATH, {
      cursor: null,
      limit: 10,
    });
    expect(keys.status).toBe("success");
    if (keys.status !== "success") return;
    expect(keys.keys).toContain("d");
    const entries = await ops.getExternalEntries(MODULE_PATH, ["d"]);
    expect(entries.status).toBe("success");
    if (entries.status !== "success") return;
    expect(entries.entries[0].content).toEqual({ title: "Drum", price: 40 });
  });

  test("a draft-removed key disappears from the key list", async () => {
    const { ops } = setup(ROWS);
    await createPatch(ops, [{ op: "remove", path: ["b"] }]);
    const keys = await ops.getExternalKeys(MODULE_PATH, {
      cursor: null,
      limit: 10,
    });
    expect(keys.status).toBe("success");
    if (keys.status !== "success") return;
    expect(keys.keys).toEqual(["a", "c"]);
  });

  test("apply_patches false shows the store as it is", async () => {
    // The Studio owns its in-flight patches and applies them itself.
    const { ops } = setup(ROWS);
    await createPatch(ops, [
      { op: "replace", path: ["a", "title"], value: "Anvil, revised" },
    ]);
    const res = await ops.getExternalEntries(MODULE_PATH, ["a"], {
      applyPatches: false,
    });
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.entries[0].content).toEqual({ title: "Anvil", price: 10 });
  });
});

describe("entries written inline", () => {
  test("read as written, and shadow the store", async () => {
    const { ops } = setup(
      { "written-inline": { title: "Stored", price: 9 } },
      {
        inline: true,
      },
    );
    const res = await ops.getExternalEntries(MODULE_PATH, ["written-inline"]);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.entries[0].content).toEqual({ title: "Inline", price: 1 });
  });

  test("are listed alongside the store's own keys", async () => {
    const { ops } = setup(ROWS, { inline: true });
    const res = await ops.getExternalKeys(MODULE_PATH, {
      cursor: null,
      limit: 10,
    });
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.keys).toEqual(["written-inline", "a", "b", "c"]);
  });
});

describe("counting", () => {
  test("a store with no count is counted by paging keys", async () => {
    const { ops } = setup(ROWS);
    const res = await ops.getExternalCount(MODULE_PATH);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.count).toEqual({ status: "counted", count: 3, exact: true });
  });

  test("count: false is declined, and declined is not zero", async () => {
    const { ops } = setup(ROWS, { count: false });
    const res = await ops.getExternalCount(MODULE_PATH);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.count).toEqual({ status: "declined" });
  });

  test("the count agrees with the keys once a draft has had its say", async () => {
    // A count that disagrees with the list it is counting is worse than none.
    const { ops } = setup(ROWS);
    await createPatch(ops, [
      { op: "add", path: ["d"], value: { title: "Drum", price: 40 } },
    ]);
    await createPatch(ops, [{ op: "remove", path: ["b"] }]);
    const res = await ops.getExternalCount(MODULE_PATH);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.count).toEqual({ status: "counted", count: 3, exact: true });
  });
});

describe("searching", () => {
  test("search: false is UNAVAILABLE, not zero hits", async () => {
    // An editor shown "no matches" by a search that never ran has been misled.
    const { ops } = setup(ROWS, { search: false });
    const res = await ops.getExternalSearch(MODULE_PATH, {
      text: "Anvil",
      cursor: null,
      limit: 10,
    });
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.mode).toBe("unavailable");
    expect(res.hits).toEqual([]);
  });

  test("with no `search`, Val answers from what it has already seen — and fetches nothing", async () => {
    const { ops, calls } = setup(ROWS);
    const cold = await ops.getExternalSearch(MODULE_PATH, {
      text: "Anvil",
      cursor: null,
      limit: 10,
    });
    expect(cold.status).toBe("success");
    if (cold.status !== "success") return;
    expect(cold.mode).toBe("partial");
    // Nothing has been read yet, so there is nothing to search — and searching a
    // 100,000-entry store must not quietly become downloading it.
    expect(cold.hits).toEqual([]);
    expect(calls.get).toHaveLength(0);

    await ops.getExternalEntries(MODULE_PATH, ["a", "b", "c"]);
    const warm = await ops.getExternalSearch(MODULE_PATH, {
      text: "anvil",
      cursor: null,
      limit: 10,
    });
    expect(warm.status).toBe("success");
    if (warm.status !== "success") return;
    expect(warm.hits.map((h) => h.key)).toEqual(["a"]);
    expect(warm.hits[0].path).toEqual(["title"]);
  });

  test("text an unpublished edit ADDED is found", async () => {
    const { ops } = setup(ROWS);
    await ops.getExternalEntries(MODULE_PATH, ["a", "b", "c"]);
    await createPatch(ops, [
      { op: "replace", path: ["b", "title"], value: "Bucket, galvanised" },
    ]);
    const res = await ops.getExternalSearch(MODULE_PATH, {
      text: "galvanised",
      cursor: null,
      limit: 10,
    });
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.hits.map((h) => h.key)).toEqual(["b"]);
  });

  test("text an unpublished edit REMOVED is not returned", async () => {
    const { ops } = setup(ROWS);
    await ops.getExternalEntries(MODULE_PATH, ["a", "b", "c"]);
    await createPatch(ops, [
      { op: "replace", path: ["a", "title"], value: "Renamed" },
    ]);
    const res = await ops.getExternalSearch(MODULE_PATH, {
      text: "Anvil",
      cursor: null,
      limit: 10,
    });
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.hits.map((h) => h.key)).toEqual([]);
  });
});

describe("a row that no longer matches the schema", () => {
  test("is reported per key, and the page is not emptied", async () => {
    // The store is not the repository: its rows can change under a schema that
    // no longer describes them.
    const rows = {
      a: { title: "Anvil", price: 10 },
      // A price the schema says is a number.
      b: { title: "Bucket", price: "twenty" } as unknown as Row,
    };
    const { ops } = setup(rows);
    const res = await ops.getExternalEntries(MODULE_PATH, ["a", "b"]);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.errors.map((e) => e.key)).toEqual(["b"]);
    expect(res.entries.map((e) => e.key)).toEqual(["a", "b"]);
  });
});

describe("an external router validates its keys as it reads them", () => {
  const ROUTER_PATH = "/app/[slug]/page.val.ts" as ModuleFilePath;
  const ROUTER_CODE = `
import { s, c, nextAppRouter } from "val.config";

export default c.define(
  "/app/[slug]/page.val.ts",
  s.router(nextAppRouter, s.object({ title: s.string() })).external("pages"),
  c.external()
);
`;

  function routerSetup(rows: Record<string, { title: string }>) {
    const { s, c, config } = initVal();
    // `initVal()` in @valbuild/core does not hand back the routers — only
    // @valbuild/next's does — so the router comes off Internal here.
    const nextAppRouter = Internal.nextAppRouter;
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-external-rt"));
    const evaluated = new Script(
      transform(ROUTER_CODE, { transforms: ["imports"] }).code,
    ).runInNewContext({
      exports: {},
      require: (p: string) => {
        if (p === "val.config") return { s, c, config, nextAppRouter };
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(p);
      },
      module: { exports: {} },
    });
    const moduleAbs = path.join(rootDir, ROUTER_PATH);
    fs.mkdirSync(path.dirname(moduleAbs), { recursive: true });
    fs.writeFileSync(moduleAbs, ROUTER_CODE);
    const routerModule = c.define(
      "/app/[slug]/page.val.ts",
      s
        .router(nextAppRouter, s.object({ title: s.string() }))
        .external("pages"),
      c.external(),
    );
    const { entry, modules } = defineExternal();
    const records = modules({
      pages: entry(routerModule, {
        keys: async () => ok({ keys: Object.keys(rows), cursor: null }),
        get: async (keys) => {
          const out: Record<string, { title: string } | null> = {};
          for (const key of keys) {
            out[key] = rows[key] ?? null;
          }
          return ok(out);
        },
        put: async () => ok(undefined),
        delete: async () => ok(undefined),
      }),
    });
    return new ValOpsFS(
      "http://localhost:4000",
      rootDir,
      { config, modules: [{ def: async () => ({ default: evaluated }) }] },
      { config, external: records },
    );
  }

  test("a key that does not match the route pattern is reported", async () => {
    // The test that would pass vacuously without per-key validation: an external
    // router's source is a marker, so "validate the whole key set" validates an
    // empty set — and looking like a check is worse than not having one.
    const ops = routerSetup({
      "/hello": { title: "Hello" },
      "/nope/deeper": { title: "Too deep for [slug]" },
    });
    const res = await ops.getExternalEntries(ROUTER_PATH, [
      "/hello",
      "/nope/deeper",
    ]);
    expect(res.status).toBe("success");
    if (res.status !== "success") return;
    expect(res.errors.map((e) => e.key)).toEqual(["/nope/deeper"]);
    // Still returned: an editor has to see the entry in order to fix its key.
    expect(res.entries.map((e) => e.key)).toEqual(["/hello", "/nope/deeper"]);
  });
});

describe("the startup checks", () => {
  test("an .external() module with no registry is a module error", async () => {
    const { s, c, config } = initVal();
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "val-external-test"));
    const moduleAbs = path.join(rootDir, MODULE_PATH);
    fs.mkdirSync(path.dirname(moduleAbs), { recursive: true });
    fs.writeFileSync(moduleAbs, MODULE_CODE);
    const evaluated = new Script(
      transform(MODULE_CODE, { transforms: ["imports"] }).code,
    ).runInNewContext({
      exports: {},
      require: (p: string) => {
        if (p === "val.config") return { s, c, config };
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(p);
      },
      module: { exports: {} },
    });
    const ops = new ValOpsFS(
      "http://localhost:4000",
      rootDir,
      { config, modules: [{ def: async () => ({ default: evaluated }) }] },
      { config },
    );
    const errors = await ops.getModuleErrors();
    expect(errors.map((e) => e.message).join("\n")).toContain(
      "no adapter is registered for 'products'",
    );
  });
});
