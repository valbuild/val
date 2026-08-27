import {
  Internal,
  ModuleFilePath,
  SerializedSchema,
  Source,
  SourcePath,
  ValModule,
  initVal,
} from "@valbuild/core";
import {
  allJsonValuesModules,
  jsonValuesLoadRequirements,
} from "./jsonValuesLoadRequirements";

const { s, c } = initVal();

const AUTHORS = "/authors.val.ts" as ModuleFilePath;
const PAGES = "/pages.val.ts" as ModuleFilePath;
const GALLERY = "/gallery.val.ts" as ModuleFilePath;
// The same string, branded as a SourcePath: that is what a `keyOf` schema stores
// when it points at a module-level record.
const PAGES_AS_SOURCE_PATH = "/pages.val.ts" as SourcePath;

describe("jsonValuesLoadRequirements", () => {
  test("nothing to load when the referrers live in ORDINARY modules", () => {
    // The incoming-ref case: renaming a key of `authors` needs the referrers,
    // which are keyOf fields in a normal module whose source is fully loaded.
    // `pages` is jsonValues but points at nothing, so none of its entries matter.
    const authors = c.define(
      AUTHORS,
      s.record(s.object({ name: s.string() })),
      { ["ada"]: { name: "Ada" } },
    );
    const schemas = getSchemas([
      authors,
      c.define("/featured.val.ts", s.keyOf(authors), "ada"),
      c.define(
        PAGES,
        s.record(s.object({ title: s.string() })).jsonValues(),
        {},
      ),
    ]);

    expect(
      jsonValuesLoadRequirements(schemas, { kind: "keyOf", module: AUTHORS }),
    ).toEqual([]);
  });

  test("a jsonValues record whose ITEM holds a keyOf must be loaded", () => {
    const authors = c.define(
      AUTHORS,
      s.record(s.object({ name: s.string() })),
      { ["ada"]: { name: "Ada" } },
    );
    const schemas = getSchemas([
      authors,
      c.define(
        PAGES,
        s
          .record(s.object({ title: s.string(), author: s.keyOf(authors) }))
          .jsonValues(),
        {},
      ),
    ]);

    expect(
      jsonValuesLoadRequirements(schemas, { kind: "keyOf", module: AUTHORS }),
    ).toEqual([PAGES]);
  });

  test("a keyOf pointing at a DIFFERENT module does not require loading", () => {
    const authors = c.define(
      AUTHORS,
      s.record(s.object({ name: s.string() })),
      { ["ada"]: { name: "Ada" } },
    );
    const other = c.define(
      "/tags.val.ts",
      s.record(s.object({ label: s.string() })),
      { ["x"]: { label: "X" } },
    );
    const schemas = getSchemas([
      authors,
      other,
      c.define(
        PAGES,
        s.record(s.object({ tag: s.keyOf(other) })).jsonValues(),
        {},
      ),
    ]);

    expect(
      jsonValuesLoadRequirements(schemas, { kind: "keyOf", module: AUTHORS }),
    ).toEqual([]);
  });

  test("the match is transitive through object, array, record and union", () => {
    const authors = c.define(
      AUTHORS,
      s.record(s.object({ name: s.string() })),
      { ["ada"]: { name: "Ada" } },
    );
    const query = { kind: "keyOf", module: AUTHORS } as const;

    const inArray = getSchemas([
      authors,
      c.define(
        PAGES,
        s.record(s.object({ list: s.array(s.keyOf(authors)) })).jsonValues(),
        {},
      ),
    ]);
    expect(jsonValuesLoadRequirements(inArray, query)).toEqual([PAGES]);

    const inNestedRecord = getSchemas([
      authors,
      c.define(
        PAGES,
        s.record(s.object({ byId: s.record(s.keyOf(authors)) })).jsonValues(),
        {},
      ),
    ]);
    expect(jsonValuesLoadRequirements(inNestedRecord, query)).toEqual([PAGES]);

    const inUnion = getSchemas([
      authors,
      c.define(
        PAGES,
        s
          .record(
            s.union(
              "type",
              s.object({ type: s.literal("plain"), text: s.string() }),
              s.object({ type: s.literal("ref"), author: s.keyOf(authors) }),
            ),
          )
          .jsonValues(),
        {},
      ),
    ]);
    expect(jsonValuesLoadRequirements(inUnion, query)).toEqual([PAGES]);

    const deeplyNested = getSchemas([
      authors,
      c.define(
        PAGES,
        s
          .record(
            s.object({
              blocks: s.array(s.object({ author: s.keyOf(authors) })),
            }),
          )
          .jsonValues(),
        {},
      ),
    ]);
    expect(jsonValuesLoadRequirements(deeplyNested, query)).toEqual([PAGES]);
  });

  test("only `.jsonValues()` records are candidates", () => {
    const authors = c.define(
      AUTHORS,
      s.record(s.object({ name: s.string() })),
      { ["ada"]: { name: "Ada" } },
    );
    // Same shape, WITHOUT .jsonValues(): its content is already in the source, so
    // there is nothing to load.
    const schemas = getSchemas([
      authors,
      c.define(PAGES, s.record(s.object({ author: s.keyOf(authors) })), {
        ["p"]: { author: "ada" },
      }),
    ]);

    expect(
      jsonValuesLoadRequirements(schemas, { kind: "keyOf", module: AUTHORS }),
    ).toEqual([]);
  });

  test("a self-referencing jsonValues record requires loading itself", () => {
    const pages: ValModule<Source> = c.define(
      PAGES,
      s.record(s.object({ title: s.string() })).jsonValues(),
      {},
    );
    // keyOf pointing back at the same module.
    const schemas = getSchemas([pages]);
    const schema = schemas[PAGES];
    if (schema.type !== "record") {
      throw new Error("expected a record");
    }
    // Hand-built, because `s.keyOf(pages)` inside `pages` is not expressible.
    schemas[PAGES] = {
      ...schema,
      item: {
        type: "object",
        items: {
          related: {
            type: "keyOf",
            path: PAGES_AS_SOURCE_PATH,
            opt: false,
            values: "string",
          },
        },
        opt: false,
      },
    };

    expect(
      jsonValuesLoadRequirements(schemas, { kind: "keyOf", module: PAGES }),
    ).toEqual([PAGES]);
  });

  test("file refs match the referenced gallery module", () => {
    const gallery = c.define(
      GALLERY,
      s.images({ directory: "/public/val" }),
      {},
    );
    const schemas = getSchemas([
      gallery,
      c.define(
        PAGES,
        s.record(s.object({ hero: s.image(gallery) })).jsonValues(),
        {},
      ),
    ]);

    expect(
      jsonValuesLoadRequirements(schemas, { kind: "file", module: GALLERY }),
    ).toEqual([PAGES]);
    // A file query must not be satisfied by a keyOf, or vice versa.
    expect(
      jsonValuesLoadRequirements(schemas, { kind: "keyOf", module: GALLERY }),
    ).toEqual([]);
  });

  test("route is an over-approximation: ANY route field counts", () => {
    // `s.route()` records no target module, so we cannot tell which router a
    // field points into and must load every jsonValues record that has one.
    const withRoute = getSchemas([
      c.define(PAGES, s.record(s.object({ link: s.route() })).jsonValues(), {}),
    ]);
    expect(jsonValuesLoadRequirements(withRoute, { kind: "route" })).toEqual([
      PAGES,
    ]);

    const withoutRoute = getSchemas([
      c.define(
        PAGES,
        s.record(s.object({ title: s.string() })).jsonValues(),
        {},
      ),
    ]);
    expect(jsonValuesLoadRequirements(withoutRoute, { kind: "route" })).toEqual(
      [],
    );
  });

  test("reports every module that needs loading", () => {
    const authors = c.define(
      AUTHORS,
      s.record(s.object({ name: s.string() })),
      { ["ada"]: { name: "Ada" } },
    );
    const schemas = getSchemas([
      authors,
      c.define(
        PAGES,
        s.record(s.object({ author: s.keyOf(authors) })).jsonValues(),
        {},
      ),
      c.define(
        "/posts.val.ts",
        s.record(s.object({ author: s.keyOf(authors) })).jsonValues(),
        {},
      ),
    ]);

    expect(
      jsonValuesLoadRequirements(schemas, {
        kind: "keyOf",
        module: AUTHORS,
      }).sort(),
    ).toEqual([PAGES, "/posts.val.ts"]);
  });
});

describe("allJsonValuesModules", () => {
  test("every module whose ROOT is a jsonValues record, and nothing else", () => {
    // Search cannot be scoped by the predicate — it indexes all content — so it
    // asks for this set instead.
    const schemas = getSchemas([
      c.define(
        PAGES,
        s.record(s.object({ title: s.string() })).jsonValues(),
        {},
      ),
      c.define(
        "/posts.val.ts",
        s.record(s.object({ title: s.string() })).jsonValues(),
        {},
      ),
      // Ordinary record: its content is already in the source.
      c.define(AUTHORS, s.record(s.object({ name: s.string() })), {
        ["ada"]: { name: "Ada" },
      }),
      c.define("/settings.val.ts", s.object({ title: s.string() }), {
        title: "Settings",
      }),
    ]);

    expect(allJsonValuesModules(schemas).sort()).toEqual([
      PAGES,
      "/posts.val.ts",
    ]);
  });

  test("empty when no module uses jsonValues (search loads nothing)", () => {
    const schemas = getSchemas([
      c.define(AUTHORS, s.record(s.object({ name: s.string() })), {
        ["ada"]: { name: "Ada" },
      }),
    ]);

    expect(allJsonValuesModules(schemas)).toEqual([]);
  });
});

function getSchemas(
  valModules: ValModule<Source>[],
): Record<ModuleFilePath, SerializedSchema> {
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  for (const valModule of valModules) {
    const moduleFilePath = Internal.getValPath(
      valModule,
    ) as unknown as ModuleFilePath;
    const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
    if (!schema) {
      throw new Error(`Schema not found for ${moduleFilePath}`);
    }
    schemas[moduleFilePath] = schema;
  }
  return schemas;
}
