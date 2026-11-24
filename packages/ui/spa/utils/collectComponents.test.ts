import {
  initVal,
  Internal,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type SelectorSource,
  type SourcePath,
  type ValModule,
} from "@valbuild/core";
import {
  collectComponents,
  componentNameOf,
  componentPages,
  componentSearchHits,
  type ComponentUse,
} from "./collectComponents";

const { s, c } = initVal();

function Noop() {
  return null;
}
const load = () => Promise.resolve({ default: Noop });

const hero = s
  .object({ type: s.literal("hero"), title: s.string() })
  .component(load, {
    examples: {
      longTitle: { type: "hero", title: "Long" },
      empty: { type: "hero", title: "" },
    },
  });
const quote = s
  .object({ type: s.literal("quote"), quote: s.string() })
  .component(load);
const card = s.object({ title: s.string() }).component(load);
const columns = s
  .object({ type: s.literal("columns"), cards: s.array(card) })
  .component(load);
const banner = s
  .object({ text: s.string() })
  .component(load, { name: "Site banner" });

const page = c.define(
  "/page.val.ts",
  s.object({
    sections: s.array(s.discriminatedUnion("type", hero, quote, columns)),
    callToAction: s.object({ label: s.string() }).component(load),
  }),
  {
    sections: [
      { type: "hero", title: "One" },
      { type: "columns", cards: [{ title: "A" }, { title: "B" }] },
      { type: "hero", title: "Two" },
    ],
    callToAction: { label: "Go" },
  },
);
const other = c.define("/other.val.ts", s.array(hero), [
  { type: "hero", title: "Elsewhere" },
]);
const unused = c.define(
  "/unused.val.ts",
  s.object({ banner }).nullable(),
  null,
);

function project(...modules: ValModule<SelectorSource>[]) {
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const sources: Record<ModuleFilePath, Json> = {};
  for (const module of modules) {
    const valPath = Internal.getValPath(module);
    if (valPath === undefined) throw new Error("A module without a path");
    const [path] = Internal.splitModuleFilePathAndModulePath(valPath);
    const schema = Internal.getSchema(module);
    if (schema) schemas[path] = schema["executeSerialize"]();
    sources[path] = Internal.getSource(module);
  }
  return { schemas, sources };
}

describe("collectComponents", () => {
  const { schemas, sources } = project(page, other, unused);
  const components = collectComponents(schemas, sources);
  const named = (name: string) => {
    const found = components.find((component) => component.name === name);
    if (!found) throw new Error(`No component ${name}`);
    return found;
  };

  test("one entry per component, named by its literal, field or name", () => {
    expect(components.map((component) => component.name).sort()).toEqual([
      "Call to action",
      "Card",
      "Columns",
      "Hero",
      "Quote",
      "Site banner",
    ]);
    expect(named("Site banner").named).toBe(true);
    expect(named("Hero").named).toBe(false);
  });

  test("every instance, across modules, through the union's variants", () => {
    expect(named("Hero").instances).toEqual([
      "/other.val.ts?p=0",
      '/page.val.ts?p="sections".0',
      '/page.val.ts?p="sections".2',
    ]);
    expect(named("Card").instances).toEqual([
      '/page.val.ts?p="sections".1."cards".0',
      '/page.val.ts?p="sections".1."cards".1',
    ]);
    expect(named("Call to action").instances).toEqual([
      '/page.val.ts?p="callToAction"',
    ]);
  });

  test("a component nothing uses is listed, with where it is linked", () => {
    expect(named("Quote").instances).toEqual([]);
    expect(named("Site banner")).toMatchObject({
      instances: [],
      linkedAt: [{ moduleFilePath: "/unused.val.ts", at: "banner" }],
    });
  });

  test("where it is linked, with a star for an item of a list", () => {
    expect(named("Hero").linkedAt).toEqual([
      { moduleFilePath: "/other.val.ts", at: "*" },
      { moduleFilePath: "/page.val.ts", at: "sections.*" },
    ]);
    expect(named("Card").linkedAt).toEqual([
      { moduleFilePath: "/page.val.ts", at: "sections.*.cards.*" },
    ]);
  });

  test("says which examples each has, by name, in order", () => {
    expect(named("Hero").examples).toEqual(["longTitle", "empty"]);
    expect(named("Quote").examples).toEqual([]);
  });

  test("the id is stable, and the same for the same schema", () => {
    const again = collectComponents(schemas, sources);
    expect(again.map((component) => component.id)).toEqual(
      components.map((component) => component.id),
    );
    expect(new Set(components.map((component) => component.id)).size).toBe(
      components.length,
    );
  });

  test("a source that is not loaded has no instances, and no error", () => {
    const withoutSources = collectComponents(schemas, {});
    expect(withoutSources).toHaveLength(components.length);
    expect(withoutSources.every((c) => c.instances.length === 0)).toBe(true);
  });
});

describe("componentNameOf", () => {
  test("two that would be called the same are numbered", () => {
    const a = s.object({ title: s.string() }).component(load);
    const b = s.object({ text: s.string() }).component(load);
    const module = c.define(
      "/twins.val.ts",
      s.object({ items: s.array(a), more: s.object({ items: s.array(b) }) }),
      { items: [], more: { items: [] } },
    );
    const { schemas, sources } = project(module);
    expect(
      collectComponents(schemas, sources).map((component) => component.name),
    ).toEqual(["Item", "Item 2"]);
  });

  test("words in an identifier", () => {
    const schema = card["executeSerialize"]();
    if (schema.type !== "object") throw new Error("expected an object");
    expect(componentNameOf(schema, ["featuredStories"]).name).toBe(
      "Featured story",
    );
    expect(componentNameOf(schema, []).name).toBe("Component");
  });
});

describe("componentSearchHits", () => {
  const { schemas, sources } = project(page, other, unused);
  const components = collectComponents(schemas, sources);
  const hit = (path: string, label = "x") => ({
    path: path as SourcePath,
    label,
  });

  test("a hit inside a use is that use's, the deepest one, once per use", () => {
    const found = componentSearchHits(
      [
        hit('/page.val.ts?p="sections".1."cards".1."title"', "B"),
        hit('/page.val.ts?p="sections".1."cards".1', "B again"),
        hit('/page.val.ts?p="sections".2."title"', "Two"),
        hit('/page.val.ts?p="sections".10."title"', "no such use"),
        hit("/other.val.ts?p=0", "Elsewhere"),
        hit("/unused.val.ts", "not in a component"),
      ],
      components,
    );
    expect(found.map((f) => [f.component.name, f.instance, f.label])).toEqual([
      ["Card", 1, "B"],
      ["Hero", 2, "Two"],
      ["Hero", 0, "Elsewhere"],
    ]);
  });
});

describe("componentPages", () => {
  const blog = c.define(
    "/app/blogs/[blog]/page.val.ts",
    s
      .record(
        s.object({
          sections: s.array(s.discriminatedUnion("type", hero, columns)),
        }),
      )
      .router(Internal.nextAppRouter),
    {
      "/blogs/a": {
        sections: [
          { type: "columns", cards: [{ title: "One" }, { title: "Two" }] },
          { type: "hero", title: "After" },
        ],
      },
      "/blogs/b": { sections: [{ type: "hero", title: "B" }] },
    },
  );
  const { schemas, sources } = project(page, blog);
  const components = collectComponents(schemas, sources);
  const pages = componentPages(schemas, sources, components);
  const shape = (uses: ComponentUse[]): unknown[] =>
    uses.map((use) =>
      use.children.length === 0
        ? use.component.name
        : [use.component.name, shape(use.children)],
    );

  test("a router's entries are pages, by route; any other module is one", () => {
    expect(pages.map((p) => [p.label, p.count])).toEqual([
      ["/blogs/a", 4],
      ["/blogs/b", 1],
      ["/page.val.ts", 6],
    ]);
    expect(pages[0].key).toBe('/app/blogs/[blog]/page.val.ts?p="/blogs/a"');
    expect(pages[0].route).toBe("/blogs/a");
  });

  test("uses are stacked in content order, and nested where they are inside another", () => {
    expect(shape(pages[0].uses)).toEqual([
      ["Columns", ["Card", "Card"]],
      "Hero",
    ]);
    expect(shape(pages[2].uses)).toEqual([
      "Hero",
      ["Columns", ["Card", "Card"]],
      "Hero",
      "Call to action",
    ]);
  });

  test("each use knows which of its component's uses it is", () => {
    const [columnsUse] = pages[0].uses;
    expect(
      columnsUse.children[1].component.instances[
        columnsUse.children[1].instance
      ],
    ).toBe(columnsUse.children[1].path);
  });
});
