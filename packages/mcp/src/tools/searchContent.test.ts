import type { Json, ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { ITEMS_PATH, PAGES_PATH, callErr, callOk, setup } from "./toolsFixture";
import { buildWithDeadline } from "./searchContent";
import type { ValToolState } from "./defineTool";

/**
 * Searching a project's content.
 *
 * The index is built per call and thrown away, so what is worth pinning is not
 * the search algorithm — `@valbuild/shared` owns that and tests it — but the
 * three things this tool adds around it: which modules get searched, what
 * happens when the clock runs out, and whether the answer says enough for a
 * caller to act on a partial one.
 */

type SearchResult = {
  results: { path: string; label: string; moduleFilePath: string }[];
  total: number;
  searched: { modules: number; of: number };
  omittedModules: string[];
  omittedModuleCount: number;
  timedOut: boolean;
  hint?: string;
};

async function search(
  tools: Awaited<ReturnType<typeof setup>>["tools"],
  args: Record<string, unknown>,
): Promise<SearchResult> {
  return (await callOk(tools, "search_content", args)) as SearchResult;
}

describe("finding things", () => {
  test("finds a value and points at the path that holds it", async () => {
    const { tools } = setup();

    const res = await search(tools, { query: "About" });

    expect(res.total).toBeGreaterThan(0);
    const hit = res.results.find((r) => r.moduleFilePath === PAGES_PATH);
    expect(hit).toBeDefined();
    // The path is the tool's whole output: it is what `get_source` reads.
    expect(hit?.path).toContain(PAGES_PATH);
  });

  test("matches on a word prefix, as the Studio does", async () => {
    const { tools } = setup();

    expect((await search(tools, { query: "Abou" })).total).toBeGreaterThan(0);
  });

  test("finds nothing gracefully", async () => {
    const { tools } = setup();

    const res = await search(tools, { query: "zzzznotinthisproject" });

    expect(res).toMatchObject({ total: 0, results: [], timedOut: false });
  });

  test("refuses an empty query rather than returning the project", async () => {
    const { tools } = setup();

    expect((await callErr(tools, "search_content", { query: "   " })).code) //
      .toBe("invalid-args");
  });

  test("says what it searched, so `total` can be read for what it is", async () => {
    const { tools } = setup();

    const res = await search(tools, { query: "First" });

    expect(res.searched.modules).toBeGreaterThan(0);
    expect(res.searched.of).toBe(res.searched.modules);
    // Present and empty, not absent: "no omissions" must not look like "this
    // tool does not report them".
    expect(res.omittedModules).toEqual([]);
    expect(res.omittedModuleCount).toBe(0);
  });
});

describe("narrowing", () => {
  test("include restricts the search to matching modules", async () => {
    const { tools } = setup();

    const res = await search(tools, {
      query: "First",
      include: [ITEMS_PATH],
    });

    expect(res.searched.of).toBe(1);
    expect(res.results.every((r) => r.moduleFilePath === ITEMS_PATH)).toBe(
      true,
    );
  });

  test("include takes a glob", async () => {
    const { tools } = setup();

    const all = await search(tools, { query: "First" });
    const globbed = await search(tools, {
      query: "First",
      include: ["/test/**"],
    });

    // The fixture lives entirely under /test, so a glob over it searches
    // everything — which is the point: the glob is matched against the whole
    // module file path, not a basename.
    expect(globbed.searched.of).toBe(all.searched.of);
  });

  test("exclude drops matching modules", async () => {
    const { tools } = setup();

    const all = await search(tools, { query: "First" });
    const without = await search(tools, {
      query: "First",
      exclude: [ITEMS_PATH],
    });

    expect(without.searched.of).toBe(all.searched.of - 1);
    expect(without.results.some((r) => r.moduleFilePath === ITEMS_PATH)).toBe(
      false,
    );
  });

  test("exclude is applied after include, not before", async () => {
    // If the two were applied the other way round — or exclude ignored when
    // include is given — this would find the module include admitted.
    const { tools } = setup();

    const err = await callErr(tools, "search_content", {
      query: "First",
      include: ["/test/**"],
      exclude: ["/test/**"],
    });

    expect(err.code).toBe("not-found");
  });

  test("says so when the filters leave nothing", async () => {
    const { tools } = setup();

    const err = await callErr(tools, "search_content", {
      query: "First",
      include: ["/nowhere/**"],
    });

    expect(err.code).toBe("not-found");
    expect(err.message).toMatch(/include\/exclude/);
  });

  test("an excluded module is not an omission", async () => {
    // The distinction the result has to keep: "you told me not to" and "I ran
    // out of time" are different answers, and only one of them means retry.
    const { tools } = setup();

    const res = await search(tools, {
      query: "First",
      exclude: [ITEMS_PATH],
    });

    expect(res.omittedModules).toEqual([]);
    expect(res.timedOut).toBe(false);
  });
});

describe("running out of time", () => {
  /**
   * Driven through `buildWithDeadline` rather than the tool.
   *
   * Tripping a real deadline through `search_content` would need a corpus that
   * takes longer to index than the smallest timeout the schema allows (100ms) —
   * which is a race on a fast machine, and a slow suite on every machine. The
   * deadline logic is the thing under test, so it is tested directly, with a
   * deadline that has already passed.
   */
  const manyModules = (n: number): ValToolState => {
    const sources: Record<string, Json> = {};
    const serializedSchemas: Record<string, SerializedSchema> = {};
    for (let i = 0; i < n; i++) {
      sources[`/test/m${i}.val.ts`] = { title: `module ${i}` };
      serializedSchemas[`/test/m${i}.val.ts`] = {
        type: "object",
        opt: false,
        items: { title: { type: "string", opt: false, raw: false } },
      };
    }
    return {
      sources,
      serializedSchemas,
      schemas: {},
      patches: { patches: [] },
      analysis: { patchesByModule: {}, fileLastUpdatedByPatchId: {} },
      unappliedPatches: {},
    } as unknown as ValToolState;
  };

  test("indexes the first module even on an expired deadline", async () => {
    // Returning nothing at all would be indistinguishable from "your content
    // does not contain this", which is a worse answer than a slow one.
    const state = manyModules(5);
    const modules = Object.keys(state.sources) as ModuleFilePath[];

    const built = buildWithDeadline(state, modules.sort(), 0);

    expect(built.indexedModules).toBe(1);
    expect(built.timedOut).toBe(true);
  });

  test("names exactly the modules it did not reach", async () => {
    const state = manyModules(5);
    const modules = (Object.keys(state.sources) as ModuleFilePath[]).sort();

    const built = buildWithDeadline(state, modules, 0);

    expect(built.omitted).toEqual(modules.slice(1));
  });

  test("indexes everything when there is time", async () => {
    const state = manyModules(5);
    const modules = (Object.keys(state.sources) as ModuleFilePath[]).sort();

    const built = buildWithDeadline(state, modules, 60_000);

    expect(built).toMatchObject({
      indexedModules: 5,
      omitted: [],
      timedOut: false,
    });
  });

  test("the tool reports a partial answer as partial, with a way out", async () => {
    // End to end, so the shape a caller sees is pinned: the flag, the count and
    // a hint that names the argument that fixes it.
    const { tools } = setup();

    const res = await search(tools, { query: "First", timeoutMs: 100 });

    if (!res.timedOut) {
      // The normal outcome for a fixture this small, and the one the numbers
      // predict for any real project too.
      expect(res.omittedModules).toEqual([]);
      expect(res.hint).toBeUndefined();
      return;
    }
    expect(res.omittedModuleCount).toBeGreaterThan(0);
    expect(res.hint).toMatch(/include/);
  });

  test("rejects a timeout outside the allowed range", async () => {
    const { tools } = setup();

    expect(
      (await callErr(tools, "search_content", { query: "a", timeoutMs: 0 }))
        .code,
    ) //
      .toBe("invalid-args");
  });
});
