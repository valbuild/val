import type { Json, ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { ITEMS_PATH, PAGES_PATH, callErr, callOk, setup } from "./toolsFixture";
import { buildWithDeadline } from "./searchContent";
import type { ValToolState } from "./defineTool";

/**
 * Searching a project's content.
 *
 * The index is built per call and thrown away, so what is worth pinning is not
 * the search algorithm — `@valbuild/shared` owns that and tests it — but the
 * four things this tool adds around it: which modules get searched, that a
 * batch of queries is answered from one pass over the index, what happens when
 * the clock runs out, and whether the answer says enough for a caller to act on
 * a partial one.
 */

type QueryAnswer = {
  query: string;
  results: { path: string; label: string; moduleFilePath: string }[];
  total: number;
  totalIsLowerBound?: boolean;
};

type SearchResult = {
  queries: QueryAnswer[];
  searched: { modules: number; of: number };
  omittedModules: string[];
  omittedModuleCount: number;
  timedOut: boolean;
  hint?: string;
};

/**
 * A query the fixture matches more than once.
 *
 * The source path is indexed alongside the value, so the field name of the two
 * array items finds both of them. Every literal VALUE in the fixture is
 * distinct, which is fine for asserting that a hit points somewhere and useless
 * for asserting anything about counting or paging.
 */
const MULTI_HIT = "label";

async function search(
  tools: Awaited<ReturnType<typeof setup>>["tools"],
  args: Record<string, unknown>,
): Promise<SearchResult> {
  return (await callOk(tools, "search_content", args)) as SearchResult;
}

/** The one answer of a single-query call. */
function only(res: SearchResult): QueryAnswer {
  expect(res.queries).toHaveLength(1);
  return res.queries[0];
}

describe("finding things", () => {
  test("finds a value and points at the path that holds it", async () => {
    const { tools } = setup();

    const answer = only(await search(tools, { queries: "About" }));

    expect(answer.total).toBeGreaterThan(0);
    const hit = answer.results.find((r) => r.moduleFilePath === PAGES_PATH);
    expect(hit).toBeDefined();
    // The path is the tool's whole output: it is what `get_source` reads.
    expect(hit?.path).toContain(PAGES_PATH);
  });

  test("matches on a word prefix, as the Studio does", async () => {
    const { tools } = setup();

    expect(only(await search(tools, { queries: "Abou" })).total) //
      .toBeGreaterThan(0);
  });

  test("finds nothing gracefully", async () => {
    const { tools } = setup();

    const res = await search(tools, { queries: "zzzznotinthisproject" });

    expect(res.timedOut).toBe(false);
    expect(only(res)).toMatchObject({ total: 0, results: [] });
  });

  test("refuses an empty query rather than returning the project", async () => {
    const { tools } = setup();

    expect((await callErr(tools, "search_content", { queries: "   " })).code) //
      .toBe("invalid-args");
  });

  test("says what it searched, so `total` can be read for what it is", async () => {
    const { tools } = setup();

    const res = await search(tools, { queries: "First" });

    expect(res.searched.modules).toBeGreaterThan(0);
    expect(res.searched.of).toBe(res.searched.modules);
    // Present and empty, not absent: "no omissions" must not look like "this
    // tool does not report them".
    expect(res.omittedModules).toEqual([]);
    expect(res.omittedModuleCount).toBe(0);
  });

  test("counts every match, not just the ones on the page", async () => {
    // `total` is what a caller decides whether to page on, so it must not be
    // the page size wearing a count's name. MULTI_HIT is a term the fixture
    // matches more than once, which is what makes the two numbers differ.
    const { tools } = setup();

    const all = only(await search(tools, { queries: MULTI_HIT }));
    const paged = only(await search(tools, { queries: MULTI_HIT, limit: 1 }));

    expect(all.total).toBeGreaterThan(1);
    expect(paged.results).toHaveLength(1);
    expect(paged.total).toBe(all.total);
  });
});

describe("several queries at once", () => {
  test("answers each one separately, in the order asked", async () => {
    // Which guess found the thing is most of why several were asked, so the
    // hits must not arrive merged.
    const { tools } = setup();

    const res = await search(tools, {
      queries: ["About", "First", "zzzznotinthisproject"],
    });

    expect(res.queries.map((q) => q.query)).toEqual([
      "About",
      "First",
      "zzzznotinthisproject",
    ]);
    expect(res.queries[0].total).toBeGreaterThan(0);
    expect(res.queries[1].total).toBeGreaterThan(0);
    expect(res.queries[2]).toMatchObject({ total: 0, results: [] });
  });

  test("a batch gets the same answers as the calls it replaces", async () => {
    // The whole claim of batching: one pass over the index, same results.
    const { tools } = setup();

    const batched = await search(tools, { queries: ["About", "First"] });
    const separately = [
      only(await search(tools, { queries: "About" })),
      only(await search(tools, { queries: "First" })),
    ];

    expect(batched.queries).toEqual(separately);
  });

  test("indexes once for the whole batch, not once per query", async () => {
    // `searched` is per call, so it stays a count of modules however many
    // queries ran against them.
    const { tools } = setup();

    const one = await search(tools, { queries: "First" });
    const many = await search(tools, {
      queries: ["First", "About", "Second", "Third"],
    });

    expect(many.searched).toEqual(one.searched);
  });

  test("a bare string is one query", async () => {
    // A caller with one query will send a string whatever the schema says.
    const { tools } = setup();

    const asString = await search(tools, { queries: "About" });
    const asList = await search(tools, { queries: ["About"] });

    expect(asString.queries).toEqual(asList.queries);
  });

  test("a repeated query is answered once", async () => {
    const { tools } = setup();

    const res = await search(tools, { queries: ["About", "About"] });

    expect(res.queries.map((q) => q.query)).toEqual(["About"]);
  });

  test("refuses a batch with an empty query in it", async () => {
    // Rather than quietly answering the rest: a caller that sent a blank
    // string built it from something, and that something was empty.
    const { tools } = setup();

    const err = await callErr(tools, "search_content", {
      queries: ["About", "  "],
    });

    expect(err.code).toBe("invalid-args");
  });

  test("rejects more queries than the response can carry", async () => {
    const { tools } = setup();

    const err = await callErr(tools, "search_content", {
      queries: Array.from({ length: 21 }, (_, i) => `q${i}`),
    });

    expect(err.code).toBe("invalid-args");
  });
});

describe("limits", () => {
  test("limit is per query, not per call", async () => {
    const { tools } = setup();

    const res = await search(tools, {
      queries: ["About", "First"],
      limit: 1,
    });

    expect(res.queries).toHaveLength(2);
    for (const answer of res.queries) {
      expect(answer.results.length).toBeLessThanOrEqual(1);
    }
  });

  test("returns everything it found when no limit is given", async () => {
    // The default is high on purpose: a model filters a long list more cheaply
    // than it asks again.
    const { tools } = setup();

    const answer = only(await search(tools, { queries: MULTI_HIT }));

    expect(answer.total).toBeGreaterThan(1);
    expect(answer.results).toHaveLength(answer.total);
  });

  test("offset pages within a query", async () => {
    const { tools } = setup();

    const first = only(await search(tools, { queries: MULTI_HIT, limit: 1 }));
    const second = only(
      await search(tools, { queries: MULTI_HIT, limit: 1, offset: 1 }),
    );

    // Both pages hold a hit — an offset past the end would make this pass
    // while proving nothing.
    expect(first.results).toHaveLength(1);
    expect(second.results).toHaveLength(1);
    expect(first.results[0].path).not.toBe(second.results[0].path);
  });

  test("rejects a limit outside the allowed range", async () => {
    const { tools } = setup();

    expect(
      (await callErr(tools, "search_content", { queries: "a", limit: 5000 }))
        .code,
    ).toBe("invalid-args");
  });
});

describe("narrowing", () => {
  test("include restricts the search to matching modules", async () => {
    const { tools } = setup();

    const res = await search(tools, {
      queries: "First",
      include: [ITEMS_PATH],
    });

    expect(res.searched.of).toBe(1);
    expect(
      only(res).results.every((r) => r.moduleFilePath === ITEMS_PATH),
    ).toBe(true);
  });

  test("include takes a glob", async () => {
    const { tools } = setup();

    const all = await search(tools, { queries: "First" });
    const globbed = await search(tools, {
      queries: "First",
      include: ["/test/**"],
    });

    // The fixture lives entirely under /test, so a glob over it searches
    // everything — which is the point: the glob is matched against the whole
    // module file path, not a basename.
    expect(globbed.searched.of).toBe(all.searched.of);
  });

  test("exclude drops matching modules", async () => {
    const { tools } = setup();

    const all = await search(tools, { queries: "First" });
    const without = await search(tools, {
      queries: "First",
      exclude: [ITEMS_PATH],
    });

    expect(without.searched.of).toBe(all.searched.of - 1);
    expect(
      only(without).results.some((r) => r.moduleFilePath === ITEMS_PATH),
    ).toBe(false);
  });

  test("exclude is applied after include, not before", async () => {
    // If the two were applied the other way round — or exclude ignored when
    // include is given — this would find the module include admitted.
    const { tools } = setup();

    const err = await callErr(tools, "search_content", {
      queries: "First",
      include: ["/test/**"],
      exclude: ["/test/**"],
    });

    expect(err.code).toBe("not-found");
  });

  test("says so when the filters leave nothing", async () => {
    const { tools } = setup();

    const err = await callErr(tools, "search_content", {
      queries: "First",
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
      queries: "First",
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

    const res = await search(tools, { queries: "First", timeoutMs: 100 });

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

  test("the deadline is per call, so it is reported once for the batch", async () => {
    // Partial means partial for every query in the call: an answer with plenty
    // of hits was still searched against a partial index.
    const { tools } = setup();

    const res = await search(tools, {
      queries: ["First", "About"],
      timeoutMs: 100,
    });

    expect(res.queries).toHaveLength(2);
    expect(typeof res.timedOut).toBe("boolean");
    expect(res.omittedModuleCount).toBe(res.omittedModules.length);
  });

  test("rejects a timeout outside the allowed range", async () => {
    const { tools } = setup();

    expect(
      (await callErr(tools, "search_content", { queries: "a", timeoutMs: 0 }))
        .code,
    ).toBe("invalid-args");
  });
});
