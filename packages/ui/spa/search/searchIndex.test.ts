import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  Source,
  ValModule,
  initVal,
} from "@valbuild/core";
import { buildSearchIndex, searchIndex } from "./searchIndex";

const { s, c } = initVal();

const PAGES = "/pages.val.ts" as ModuleFilePath;

/** The paths a query matches, sorted so the test does not depend on ranking. */
function find(
  modules: Record<ModuleFilePath, { source: Json; schema: SerializedSchema }>,
  query: string,
): string[] {
  const index = buildSearchIndex(modules);
  return searchIndex(index, query)
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
          image: c.image("/public/val/content/imageOfPerson.jpg"),
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
