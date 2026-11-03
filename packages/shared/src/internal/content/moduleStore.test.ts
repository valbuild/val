import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { baseModuleContent } from "./applyChain";
import {
  bundleTier,
  memoryTier,
  parseModuleKey,
  pathOfModuleKey,
  storeWork,
  tiered,
  type StoredModule,
} from "./moduleStore";
import { EMPTY_CHAIN, moduleKey, type ModuleVersion } from "./version";

const HOME = "/content/home.val.ts" as ModuleFilePath;
const LIST = "/content/list.val.ts" as ModuleFilePath;

const at = (chain: string): ModuleVersion => ({
  schema: "s",
  base: "b",
  chain,
});
const stored = (
  path: ModuleFilePath,
  chain: string,
  bytes: number,
): StoredModule => ({
  path,
  version: at(chain),
  content: baseModuleContent({ chain }),
  patches: chain === EMPTY_CHAIN ? [] : [chain as PatchId],
  bytes,
});

describe("memoryTier", () => {
  test("keeps the last N versions of a module, and the newest is its latest", () => {
    const memory = memoryTier({ budgetBytes: 1000, lastPerModule: 2 });
    for (const chain of ["c1", "c2", "c3"]) {
      const value = stored(HOME, chain, 10);
      memory.put(moduleKey(HOME, value.version), value, value.bytes);
    }
    expect(memory.stats()).toMatchObject({
      versions: 2,
      modules: 1,
      bytes: 20,
      mostVersionsOfOneModule: 2,
    });
    expect(memory.get(moduleKey(HOME, at("c1")))).toBeNull();
    expect(memory.latest(HOME)?.version.chain).toBe("c3");
  });

  test("lets the least recently read go when over its budget, never the one just put", () => {
    const memory = memoryTier({ budgetBytes: 25, lastPerModule: 2 });
    const home = stored(HOME, "c1", 10);
    const list = stored(LIST, "c1", 10);
    memory.put(moduleKey(HOME, home.version), home, 10);
    memory.put(moduleKey(LIST, list.version), list, 10);
    // Read HOME: LIST is now the least recently read.
    memory.get(moduleKey(HOME, home.version));
    const bigger = stored(HOME, "c2", 10);
    memory.put(moduleKey(HOME, bigger.version), bigger, 10);
    expect(memory.get(moduleKey(LIST, list.version))).toBeNull();
    expect(memory.stats().bytes).toBe(20);
    const huge = stored(LIST, "c2", 100);
    memory.put(moduleKey(LIST, huge.version), huge, 100);
    expect(memory.get(moduleKey(LIST, huge.version))).toBe(huge);
    expect(memory.stats().versions).toBe(1);
  });

  test("a charge counts against the budget", () => {
    const memory = memoryTier({ budgetBytes: 100, lastPerModule: 2 });
    const home = stored(HOME, "c1", 10);
    const key = moduleKey(HOME, home.version);
    memory.put(key, home, 10);
    memory.charge(key, 15);
    expect(memory.stats().bytes).toBe(25);
  });
});

describe("tiered", () => {
  test("asks each tier in turn, and writes a slower answer to the faster ones", async () => {
    const memory = memoryTier({ budgetBytes: 100, lastPerModule: 2 });
    const bundle = bundleTier((path) =>
      path === HOME
        ? { version: at(EMPTY_CHAIN), source: { title: "Hello" } }
        : null,
    );
    const store = tiered([memory, bundle]);
    const key = moduleKey(HOME, at(EMPTY_CHAIN));
    const before = storeWork();
    const first = await store.get(key);
    expect(first?.content.source).toEqual({ title: "Hello" });
    expect(first?.bytes).toBe(0);
    expect(memory.get(key)).toBe(first);
    expect(await store.get(moduleKey(HOME, at("c1")))).toBeNull();
    const after = storeWork();
    expect(after.hits["bundle"]).toBe((before.hits["bundle"] ?? 0) + 1);
    expect(after.misses).toBe(before.misses + 1);
  });

  test("the bundle answers its own version only", async () => {
    const bundle = bundleTier(() => ({
      version: at(EMPTY_CHAIN),
      source: { title: "Hello" },
    }));
    expect(await bundle.get(moduleKey(HOME, at(EMPTY_CHAIN)))).not.toBeNull();
    expect(
      await bundle.get(
        moduleKey(HOME, { ...at(EMPTY_CHAIN), base: "another base" }),
      ),
    ).toBeNull();
  });
});

test("a module key names its path and version, and parses back", () => {
  const version = at("c1");
  const key = moduleKey(HOME, version);
  expect(pathOfModuleKey(key)).toBe(HOME);
  expect(parseModuleKey(key)).toEqual({ path: HOME, version });
  expect(parseModuleKey("not a key")).toBeNull();
});
