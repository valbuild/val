import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  Source,
  ValModule,
  initVal,
} from "@valbuild/core";
import { buildSearchIndex, performSearch } from "./searchIndex";

const { s, c } = initVal();

const PAGES = "/pages.val.ts" as ModuleFilePath;

/** The paths a query matches, sorted so the test does not depend on ranking. */
function find(
  modules: Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>,
  query: string,
): string[] {
  const index = buildSearchIndex(modules);
  return performSearch(index, query)
    .results.map((result) => result.path as string)
    .sort();
}

describe("buildSearchIndex", () => {
  test("indexes primitives, richtext text (not tags) and file names", () => {
    const modules = getModules([
      c.define(
        "/content.val.ts",
        s.object({
          title: s.string(),
          count: s.number(),
          body: s.richtext(),
          image: s.image(),
        }),
        {
          title: "Hello world",
          count: 42,
          body: [
            {
              tag: "p",
              children: [
                "Hello from ",
                { tag: "span", styles: ["bold"], children: ["the richtext"] },
              ],
            },
          ],
          image: { path: "/public/val/content/imageOfPerson.jpg" },
        },
      ),
    ]);

    expect(find(modules, "world")).toEqual(['/content.val.ts?p="title"']);
    expect(find(modules, "richtext")).toEqual(['/content.val.ts?p="body"']);
    // Richtext TAGS are not content and must not be searchable.
    expect(find(modules, "span")).toEqual([]);
    expect(find(modules, "42")).toEqual(['/content.val.ts?p="count"']);
    expect(find(modules, "imageOfPerson.jpg")).toEqual([
      '/content.val.ts?p="image"',
    ]);
    // The path itself is indexed alongside the value, so a field name finds it.
    expect(find(modules, "title")).toEqual(['/content.val.ts?p="title"']);
  });

  test("an un-loaded jsonValues entry contributes NOTHING", () => {
    // Regression: the marker used to fall through to the branch its ITEM schema
    // selects. Here the item is a record of strings, so the marker's OWN keys got
    // walked and `_type: "json"` was indexed as if it were content.
    const schema = s.record(s.record(s.string())).jsonValues();
    const modules: Record<
      ModuleFilePath,
      { source: Json; schema: SerializedSchema }
    > = {
      [PAGES]: {
        schema: schema["executeSerialize"](),
        // What the client holds before an entry is loaded: an opaque marker.
        source: { "/a": { _type: "json" } } as unknown as Json,
      },
    };

    expect(find(modules, "json")).toEqual([]);
    expect(find(modules, "_type")).toEqual([]);
  });

  test("a loaded jsonValues entry IS indexed (content substituted for the marker)", () => {
    const schema = s
      .record(s.object({ title: s.string() }))
      .jsonValues()
      ["executeSerialize"]();
    const partiallyLoaded: Record<
      ModuleFilePath,
      { source: Json; schema: SerializedSchema }
    > = {
      [PAGES]: {
        schema,
        source: {
          // What `getPatchedSource` produces once /json lands for "/a" only.
          "/a": { title: "Loaded page" },
          "/b": { _type: "json" },
        } as unknown as Json,
      },
    };

    expect(find(partiallyLoaded, "Loaded")).toEqual([
      '/pages.val.ts?p="/a"."title"',
    ]);
  });

  // An enum's value is a string an editor picked, so it is as findable as any
  // other string leaf. The former string union was never indexed at all — it
  // reached the indexer with a schema type the indexer had no branch for, and
  // fell out at the empty-searchText check.
  test("indexes enum values", () => {
    const modules = getModules([
      c.define(
        "/content.val.ts",
        s.object({ size: s.enum("small", "medium", "large") }),
        { size: "medium" },
      ),
    ]);
    expect(find(modules, "medium")).toEqual(['/content.val.ts?p="size"']);
  });

  // Same reason, and the same failure: `traverseSchemaSource` visits a locale
  // leaf, so one that the indexer has no branch for is visited and then
  // dropped at the empty-searchText check — which looks exactly like content
  // that does not exist.
  test("indexes locale tags", () => {
    const modules = getModules([
      c.define(
        "/content.val.ts",
        s.object({ locale: s.locale(), title: s.string() }),
        { locale: "nb-NO", title: "Vinterjakka" },
      ),
    ]);
    expect(find(modules, "nb-NO")).toEqual(['/content.val.ts?p="locale"']);
  });
});

describe("performSearch", () => {
  /** One module, `n` entries, every one of them matching "match". */
  function manyMatches(n: number) {
    const source: Record<string, Json> = {};
    for (let i = 0; i < n; i++) {
      source[`k${i}`] = `match ${i}`;
    }
    return {
      [PAGES]: {
        source: source as Json,
        schema: {
          type: "record",
          opt: false,
          item: { type: "string", opt: false, raw: false },
        } as SerializedSchema,
      },
    };
  }

  test("counts every match, not just the page it returns", () => {
    // The count a caller decides whether to page on. Taken from a
    // page-sized search it would just be the page size again, which reads as
    // "that is all there is" — so it is asked for separately.
    const index = buildSearchIndex(manyMatches(30));

    const page = performSearch(index, "match", 5);

    expect(page.results).toHaveLength(5);
    expect(page.total).toBe(30);
    expect(page.totalIsLowerBound).toBe(false);
  });

  test("the count survives paging", () => {
    const index = buildSearchIndex(manyMatches(30));

    expect(performSearch(index, "match", 5, 20).total).toBe(30);
  });

  test("says when the count is a lower bound rather than a count", () => {
    // Counting stops somewhere, and where it stopped has to be visible: a
    // caller that reads a floor as a total draws exactly the wrong conclusion
    // about how much it has not seen. Sat on the boundary, because a flag that
    // is only ever asserted false is not tested at all.
    const under = performSearch(buildSearchIndex(manyMatches(9_999)), "match");
    const at = performSearch(buildSearchIndex(manyMatches(10_001)), "match");

    expect(under).toMatchObject({ total: 9_999, totalIsLowerBound: false });
    expect(at).toMatchObject({ total: 10_000, totalIsLowerBound: true });
  });

  test("an empty query is not a search", () => {
    const index = buildSearchIndex(manyMatches(3));

    expect(performSearch(index, "   ")).toEqual({
      results: [],
      total: 0,
      totalIsLowerBound: false,
    });
  });
});

function getModules(
  valModules: ValModule<Source>[],
): Record<ModuleFilePath, { source: Json; schema: SerializedSchema }> {
  const modules: Record<
    ModuleFilePath,
    { source: Json; schema: SerializedSchema }
  > = {};
  for (const valModule of valModules) {
    const moduleFilePath = Internal.getValPath(
      valModule,
    ) as unknown as ModuleFilePath;
    const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
    if (!schema) {
      throw new Error(`Schema not found for ${moduleFilePath}`);
    }
    modules[moduleFilePath] = {
      schema,
      source: Internal.getSource(valModule) as Json,
    };
  }
  return modules;
}
