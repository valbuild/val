import {
  Internal,
  isComponentModule,
  ModuleFilePath,
  SerializedSchema,
  Source,
  ValModule,
  initVal,
} from "@valbuild/core";
import { findSchemaUsages } from "./findSchemaUsages";

const { s, c } = initVal();

// A component module needs a component; what it renders is irrelevant here.
const noopComponent = () => null;

describe("findSchemaUsages: unions", () => {
  test("finds each member of a discriminated union in an array", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const quoteSchema = s.object({
      type: s.literal("quote"),
      quote: s.string(),
    });
    const hero = c.component("/hero.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });
    const quote = c.component("/quote.val.tsx", noopComponent, quoteSchema, {
      type: "quote",
      quote: "example",
    });
    const pages = c.define(
      "/pages.val.ts",
      s.record(
        s.object({
          sections: s.array(s.union("type", heroSchema, quoteSchema)),
        }),
      ),
      {
        landing: {
          sections: [
            { type: "hero", title: "Landing hero" },
            { type: "quote", quote: "Landing quote" },
          ],
        },
        pricing: {
          sections: [{ type: "hero", title: "Pricing hero" }],
        },
      },
    );

    expect(usagesOf([hero, quote, pages])).toEqual([
      {
        sourcePath: '/pages.val.ts?p="landing"."sections".0',
        moduleFilePath: "/pages.val.ts",
        componentPaths: ["/hero.val.tsx"],
      },
      {
        sourcePath: '/pages.val.ts?p="landing"."sections".1',
        moduleFilePath: "/pages.val.ts",
        componentPaths: ["/quote.val.tsx"],
      },
      {
        sourcePath: '/pages.val.ts?p="pricing"."sections".0',
        moduleFilePath: "/pages.val.ts",
        componentPaths: ["/hero.val.tsx"],
      },
    ]);
  });

  test("finds a union member behind an object property", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const quoteSchema = s.object({
      type: s.literal("quote"),
      quote: s.string(),
    });
    const hero = c.component("/hero.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });
    const page = c.define(
      "/page.val.ts",
      s.object({ banner: s.union("type", heroSchema, quoteSchema) }),
      { banner: { type: "hero", title: "Banner hero" } },
    );

    expect(usagesOf([hero, page])).toEqual([
      {
        sourcePath: '/page.val.ts?p="banner"',
        moduleFilePath: "/page.val.ts",
        componentPaths: ["/hero.val.tsx"],
      },
    ]);
  });

  test("finds a component whose own schema is the union", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const quoteSchema = s.object({
      type: s.literal("quote"),
      quote: s.string(),
    });
    // The component takes any section, not one specific kind
    const sectionSchema = s.union("type", heroSchema, quoteSchema);
    const section = c.component(
      "/section.val.tsx",
      noopComponent,
      sectionSchema,
      { type: "hero", title: "example" },
    );
    const pages = c.define(
      "/pages.val.ts",
      s.object({ sections: s.array(sectionSchema) }),
      {
        sections: [
          { type: "hero", title: "A hero" },
          { type: "quote", quote: "A quote" },
        ],
      },
    );

    expect(usagesOf([section, pages])).toEqual([
      {
        sourcePath: '/pages.val.ts?p="sections".0',
        moduleFilePath: "/pages.val.ts",
        componentPaths: ["/section.val.tsx"],
      },
      {
        sourcePath: '/pages.val.ts?p="sections".1',
        moduleFilePath: "/pages.val.ts",
        componentPaths: ["/section.val.tsx"],
      },
    ]);
  });

  test("does not match a union member that only looks similar", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const hero = c.component("/hero.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });
    // Same discriminator, one extra field: a different schema
    const almostHeroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
      subtitle: s.string(),
    });
    const pages = c.define(
      "/pages.val.ts",
      s.object({ sections: s.array(s.union("type", almostHeroSchema)) }),
      { sections: [{ type: "hero", title: "Not it", subtitle: "extra" }] },
    );

    expect(usagesOf([hero, pages])).toEqual([]);
  });

  test("a discriminator value with no matching member yields nothing", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const quoteSchema = s.object({
      type: s.literal("quote"),
      quote: s.string(),
    });
    const hero = c.component("/hero.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });
    const pages = c.define(
      "/pages.val.ts",
      s.object({ sections: s.array(s.union("type", heroSchema, quoteSchema)) }),
      { sections: [{ type: "hero", title: "Valid" }] },
    );

    // The schema rejects an unknown discriminator, so this state cannot be
    // written in a .val file - but it does occur when a union member is removed
    // and content has not been migrated yet. Substituting the source keeps the
    // test type safe while still exercising that path.
    const { schemas, sources } = getTestData([hero, pages]);
    sources["/pages.val.ts" as ModuleFilePath] = {
      sections: [{ type: "banner", title: "Unknown" }],
    };
    const run = () =>
      findSchemaUsages(schemas, sources, ["/hero.val.tsx" as ModuleFilePath]);
    expect(run).not.toThrow();
    expect(run().usages).toEqual([]);
  });

  test("string unions are ignored, not descended into", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const hero = c.component("/hero.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });
    const pages = c.define(
      "/pages.val.ts",
      s.object({ size: s.union(s.literal("sm"), s.literal("lg")) }),
      { size: "sm" },
    );

    expect(() => usagesOf([hero, pages])).not.toThrow();
    expect(usagesOf([hero, pages])).toEqual([]);
  });

  test("nested: union inside a record inside an array", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const hero = c.component("/hero.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });
    const pages = c.define(
      "/pages.val.ts",
      s.record(s.array(s.record(s.union("type", heroSchema)))),
      {
        landing: [{ top: { type: "hero", title: "Deep hero" } }],
      },
    );

    expect(usagesOf([hero, pages])).toEqual([
      {
        sourcePath: '/pages.val.ts?p="landing".0."top"',
        moduleFilePath: "/pages.val.ts",
        componentPaths: ["/hero.val.tsx"],
      },
    ]);
  });

  test("a union member shared by two components lists both", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const wide = c.component("/wide.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });
    const narrow = c.component("/narrow.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });
    const pages = c.define(
      "/pages.val.ts",
      s.object({ sections: s.array(s.union("type", heroSchema)) }),
      { sections: [{ type: "hero", title: "Shared" }] },
    );

    expect(usagesOf([wide, narrow, pages])).toEqual([
      {
        sourcePath: '/pages.val.ts?p="sections".0',
        moduleFilePath: "/pages.val.ts",
        componentPaths: ["/wide.val.tsx", "/narrow.val.tsx"],
      },
    ]);
  });

  test("the component module's own content is not a usage of itself", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const hero = c.component("/hero.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });

    expect(usagesOf([hero])).toEqual([]);
  });

  test("finds a union member behind a nullable union", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const hero = c.component("/hero.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });
    const pages = c.define(
      "/pages.val.ts",
      s.object({
        banner: s.union("type", heroSchema).nullable(),
        footer: s.union("type", heroSchema).nullable(),
      }),
      {
        banner: { type: "hero", title: "Optional but present" },
        footer: null,
      },
    );

    expect(usagesOf([hero, pages])).toEqual([
      {
        sourcePath: '/pages.val.ts?p="banner"',
        moduleFilePath: "/pages.val.ts",
        componentPaths: ["/hero.val.tsx"],
      },
    ]);
  });

  // KNOWN LIMITATION: matching is structural, and a modifier changes the
  // serialized schema. Pinned so that fixing it is a deliberate change.
  test("does not find a member that has a modifier applied", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const hero = c.component("/hero.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });
    const pages = c.define(
      "/pages.val.ts",
      s.object({
        sections: s.array(
          s.union("type", heroSchema.describe("The hero section")),
        ),
      }),
      { sections: [{ type: "hero", title: "Described" }] },
    );

    expect(usagesOf([hero, pages])).toEqual([]);
  });

  test("reports truncation when the limit is hit", () => {
    const heroSchema = s.object({
      type: s.literal("hero"),
      title: s.string(),
    });
    const hero = c.component("/hero.val.tsx", noopComponent, heroSchema, {
      type: "hero",
      title: "example",
    });
    const pages = c.define(
      "/pages.val.ts",
      s.object({ sections: s.array(s.union("type", heroSchema)) }),
      {
        sections: [
          { type: "hero", title: "1" },
          { type: "hero", title: "2" },
          { type: "hero", title: "3" },
        ],
      },
    );

    const { schemas, sources } = getTestData([hero, pages]);
    const result = findSchemaUsages(
      schemas,
      sources,
      ["/hero.val.tsx" as ModuleFilePath],
      { limit: 2 },
    );
    expect(result.usages).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});

function usagesOf(valModules: ValModule<Source>[]) {
  const { schemas, sources } = getTestData(valModules);
  const componentPaths = valModules
    .filter((valModule) => isComponentModule(valModule))
    .map(getModuleFilePath);
  const result = findSchemaUsages(schemas, sources, componentPaths);
  expect(result.truncated).toBe(false);
  return result.usages;
}

function getTestData(valModules: ValModule<Source>[]) {
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const sources: Record<ModuleFilePath, Source> = {};
  for (const valModule of valModules) {
    const moduleFilePath = getModuleFilePath(valModule);
    schemas[moduleFilePath] = getSchema(valModule);
    sources[moduleFilePath] = getSource(valModule);
  }
  return { schemas, sources };
}

function getModuleFilePath(valModule: ValModule<Source>): ModuleFilePath {
  return Internal.getValPath(valModule) as unknown as ModuleFilePath;
}

function getSchema(valModule: ValModule<Source>): SerializedSchema {
  const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
  if (!schema) {
    throw new Error("Schema not found");
  }
  return schema;
}

function getSource(valModule: ValModule<Source>): Source {
  const source = Internal.getSource(valModule);
  if (source === undefined) {
    throw new Error("Source not found");
  }
  return source;
}
