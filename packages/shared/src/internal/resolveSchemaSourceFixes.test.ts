import {
  Internal,
  initVal,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
  type ValidationError,
  type ValidationFix,
  type ValModule,
} from "@valbuild/core";
import {
  isSchemaSourceFixError,
  resolveSchemaSourceFixes,
  resolveSchemaSourceFixForError,
} from "./resolveSchemaSourceFixes";

const { s, c } = initVal();

function getTestData(valModules: ValModule<Source>[]) {
  const schemas: Record<ModuleFilePath, SerializedSchema> = {};
  const sources: Record<ModuleFilePath, Source> = {};
  for (const valModule of valModules) {
    const moduleFilePath = Internal.getValPath(
      valModule,
    ) as unknown as ModuleFilePath;
    const schema = Internal.getSchema(valModule)?.["executeSerialize"]();
    if (!schema) throw new Error("Schema not found");
    schemas[moduleFilePath] = schema;
    const source = Internal.getSource(valModule);
    if (source === undefined) throw new Error("Source not found");
    sources[moduleFilePath] = source;
  }
  return { schemas, sources };
}

describe("resolveSchemaSourceFixes", () => {
  test("errors without keyof/router fixes pass through unchanged", () => {
    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        { message: "Required field" },
        { message: "Missing metadata", fixes: ["image:check-metadata"] },
        { message: "Missing metadata", fixes: ["file:add-metadata"] },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas: {},
      sources: {},
    });
    expect(result).toEqual(errors);
  });

  test("keyof:check-keys — valid key drops error", () => {
    const pages = c.define(
      "/content/pages.val.ts",
      s.record(s.object({ title: s.string() })),
      { home: { title: "Home" }, about: { title: "About" } },
    );
    const { schemas, sources } = getTestData([pages]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/ref.val.ts" as SourcePath]: [
        {
          message: "keyof check",
          fixes: ["keyof:check-keys"],
          value: {
            key: "home",
            sourcePath: "/content/pages.val.ts" as SourcePath,
          },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    expect(result).toEqual({});
  });

  test("keyof:check-keys — invalid key surfaces with 'did you mean' suggestion", () => {
    const pages = c.define(
      "/content/pages.val.ts",
      s.record(s.object({ title: s.string() })),
      { home: { title: "Home" }, about: { title: "About" } },
    );
    const { schemas, sources } = getTestData([pages]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/ref.val.ts" as SourcePath]: [
        {
          message: "keyof check",
          fixes: ["keyof:check-keys"],
          value: {
            key: "hone",
            sourcePath: "/content/pages.val.ts" as SourcePath,
          },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    const message =
      result["/content/ref.val.ts" as SourcePath]?.[0]?.message ?? "";
    expect(message).toContain("hone");
    expect(message).toContain("Closest match: 'home'");
    expect(message).toContain("about");
    expect(
      result["/content/ref.val.ts" as SourcePath]?.[0]?.fixes,
    ).toBeUndefined();
  });

  test("keyof:check-keys — array source with numeric key is not treated as valid", () => {
    // Schema says record but the source is (accidentally) an array. A numeric
    // string key like "0" satisfies `"0" in ["x", "y"]`, so without the
    // Array.isArray guard the error would be wrongly resolved as valid.
    const data = c.define("/content/data.val.ts", s.record(s.string()), {
      a: "x",
    });
    const { schemas } = getTestData([data]);
    const sources: Record<ModuleFilePath, Source> = {
      ["/content/data.val.ts" as ModuleFilePath]: ["x", "y"],
    };

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/ref.val.ts" as SourcePath]: [
        {
          message: "keyof check",
          fixes: ["keyof:check-keys"],
          value: {
            key: "0",
            sourcePath: "/content/data.val.ts" as SourcePath,
          },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, { schemas, sources });
    // The error must surface (not be dropped) and lose its auto-fix.
    expect(result["/content/ref.val.ts" as SourcePath]).toHaveLength(1);
    expect(
      result["/content/ref.val.ts" as SourcePath]?.[0]?.fixes,
    ).toBeUndefined();
  });

  test("keyof:check-keys — missing value yields typeError", () => {
    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/ref.val.ts" as SourcePath]: [
        { message: "keyof check", fixes: ["keyof:check-keys"] },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas: {},
      sources: {},
    });
    const error = result["/content/ref.val.ts" as SourcePath]?.[0];
    expect(error?.typeError).toBe(true);
    expect(error?.message).toContain("version mismatch");
  });

  test("router:check-route — valid route drops error", () => {
    const router = c.define(
      "/content/router.val.ts",
      s.record(s.string()).router(Internal.nextAppRouter),
      { "/blog/post-1": "post-1", "/blog/post-2": "post-2" },
    );
    const { schemas, sources } = getTestData([router]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        {
          message: "router check",
          fixes: ["router:check-route"],
          value: { route: "/blog/post-1" },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    expect(result).toEqual({});
  });

  test("router:check-route — invalid route surfaces with 'did you mean'", () => {
    const router = c.define(
      "/content/router.val.ts",
      s.record(s.string()).router(Internal.nextAppRouter),
      { "/blog/post-1": "post-1", "/blog/post-2": "post-2" },
    );
    const { schemas, sources } = getTestData([router]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        {
          message: "router check",
          fixes: ["router:check-route"],
          value: { route: "/blog/post-3" },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    const message =
      result["/content/page.val.ts" as SourcePath]?.[0]?.message ?? "";
    expect(message).toContain("/blog/post-3");
    expect(message).toContain("/blog/post-1");
    expect(message).toContain("/blog/post-2");
    expect(
      result["/content/page.val.ts" as SourcePath]?.[0]?.fixes,
    ).toBeUndefined();
  });

  test("router:check-route — include pattern matching route is dropped", () => {
    const router = c.define(
      "/content/router.val.ts",
      s.record(s.string()).router(Internal.nextAppRouter),
      { "/blog/post-1": "post-1", "/shop/item-1": "item-1" },
    );
    const { schemas, sources } = getTestData([router]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        {
          message: "router check",
          fixes: ["router:check-route"],
          value: {
            route: "/blog/post-1",
            include: { source: "^\\/blog\\/", flags: "" },
          },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    expect(result).toEqual({});
  });

  test("router:check-route — excluded route remains", () => {
    const router = c.define(
      "/content/router.val.ts",
      s.record(s.string()).router(Internal.nextAppRouter),
      { "/blog/post-1": "post-1", "/shop/item-1": "item-1" },
    );
    const { schemas, sources } = getTestData([router]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        {
          message: "router check",
          fixes: ["router:check-route"],
          value: {
            route: "/shop/item-1",
            exclude: { source: "^\\/shop\\/", flags: "" },
          },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    expect(result["/content/page.val.ts" as SourcePath]).toHaveLength(1);
  });

  test("router:check-route — no router modules produces explanatory error", () => {
    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/page.val.ts" as SourcePath]: [
        {
          message: "router check",
          fixes: ["router:check-route"],
          value: { route: "/some/route" },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas: {},
      sources: {},
    });
    const message =
      result["/content/page.val.ts" as SourcePath]?.[0]?.message ?? "";
    expect(message).toContain("No router modules found");
  });

  test("mix: some errors resolved, some rewritten, some untouched", () => {
    const pages = c.define(
      "/content/pages.val.ts",
      s.record(s.object({ title: s.string() })),
      { home: { title: "Home" } },
    );
    const { schemas, sources } = getTestData([pages]);

    const errors: Record<SourcePath, ValidationError[]> = {
      ["/content/ref.val.ts" as SourcePath]: [
        { message: "type error" },
        { message: "image meta", fixes: ["image:check-metadata"] },
        {
          message: "keyof check valid",
          fixes: ["keyof:check-keys"],
          value: {
            key: "home",
            sourcePath: "/content/pages.val.ts" as SourcePath,
          },
        },
        {
          message: "keyof check invalid",
          fixes: ["keyof:check-keys"],
          value: {
            key: "nope",
            sourcePath: "/content/pages.val.ts" as SourcePath,
          },
        },
      ],
    };
    const result = resolveSchemaSourceFixes(errors, {
      schemas,
      sources: sources as Record<ModuleFilePath, Source>,
    });
    // type error, image meta (passthrough), invalid keyof → 3 entries (valid keyof dropped)
    expect(result["/content/ref.val.ts" as SourcePath]).toHaveLength(3);
  });
});

describe("resolveSchemaSourceFixForError", () => {
  test("returns null for unrelated fix codes", () => {
    expect(
      resolveSchemaSourceFixForError(
        { message: "x", fixes: ["image:check-metadata"] },
        { schemas: {}, sources: {} },
      ),
    ).toBeNull();
  });

  test("returns null for errors without fixes", () => {
    expect(
      resolveSchemaSourceFixForError(
        { message: "x" },
        { schemas: {}, sources: {} },
      ),
    ).toBeNull();
  });
});

describe("record:fill-keys", () => {
  const at = "/content/page.val.ts" as SourcePath;

  /** A project whose settings declare `available`. */
  function project(available: string[]) {
    const settings = c.define("/settings.val.ts", s.settings(), {
      locales: { available, default: available[0] ?? null },
    });
    return getTestData([settings]);
  }

  /** The error a declared-key record raises, before it is resolved. */
  function unresolved(value: {
    present: string[];
    declared: string[] | null;
    aliases?: Record<string, string[]>;
  }): Record<SourcePath, ValidationError[]> {
    return {
      [at]: [
        {
          message: "Did not validate record keys.",
          fixes: ["record:fill-keys"],
          value,
        },
      ],
    };
  }

  test("a literal union brings its own keys, and a complete record resolves away", () => {
    expect(
      resolveSchemaSourceFixes(
        unresolved({ present: ["a", "b"], declared: ["a", "b"] }),
        project([]),
      ),
    ).toEqual({});
  });

  test("a missing key is named, and the null is explained", () => {
    const result = resolveSchemaSourceFixes(
      unresolved({ present: ["a"], declared: ["a", "b"] }),
      project([]),
    );
    expect(result[at][0].message).toContain("Missing key: 'b'");
    expect(result[at][0].message).toContain("null, not absent");
    expect(result[at][0].fixes).toBeUndefined();
    expect(result[at][0].value).toEqual({
      missing: ["b"],
      declared: ["a", "b"],
    });
  });

  test("several missing keys read as a plural, in declaration order", () => {
    const result = resolveSchemaSourceFixes(
      unresolved({ present: ["b"], declared: ["a", "b", "c"] }),
      project([]),
    );
    expect(result[at][0].message).toContain("Missing keys: 'a', 'c'");
  });

  test("a locale record takes its keys from the settings module", () => {
    expect(
      resolveSchemaSourceFixes(
        unresolved({ present: ["en-US", "nb-NO"], declared: null }),
        project(["en-US", "nb-NO"]),
      ),
    ).toEqual({});
    const result = resolveSchemaSourceFixes(
      unresolved({ present: ["en-US"], declared: null }),
      project(["en-US", "nb-NO"]),
    );
    expect(result[at][0].message).toContain("Missing key: 'nb-NO'");
  });

  test("with aliases the required keys are the spellings, not the tags", () => {
    const result = resolveSchemaSourceFixes(
      unresolved({
        present: ["en"],
        declared: null,
        aliases: { "en-US": ["en"], "nb-NO": ["no"] },
      }),
      project(["en-US", "nb-NO"]),
    );
    expect(result[at][0].message).toContain("Missing key: 'no'");
  });

  test("a project with no languages requires nothing of a locale record", () => {
    // The locale field's own check already says the project has declared none.
    // Demanding entries for a list that does not exist would be a second error
    // about the same missing decision.
    expect(
      resolveSchemaSourceFixes(
        unresolved({ present: [], declared: null }),
        project([]),
      ),
    ).toEqual({});
  });

  test("a malformed error value is reported as a version mismatch, not a crash", () => {
    const result = resolveSchemaSourceFixes(
      {
        [at]: [
          {
            message: "Did not validate record keys.",
            fixes: ["record:fill-keys"],
            value: { declared: ["a"] },
          },
        ],
      },
      project([]),
    );
    expect(result[at][0].typeError).toBe(true);
  });
});

describe("locale:check-locale", () => {
  /** A project whose settings declare `available`, plus one locale field. */
  function project(available: unknown) {
    const settings = c.define("/settings.val.ts", s.settings(), {
      locales: { available: available as string[] },
    });
    const page = c.define(
      "/content/page.val.ts",
      s.object({ locale: s.locale() }),
      { locale: "nb-NO" },
    );
    return getTestData([settings, page]);
  }

  /** The error a locale field raises, before it is resolved. */
  function unresolved(
    locale: string,
    aliases?: Record<string, string[]>,
  ): Record<SourcePath, ValidationError[]> {
    return {
      ['/content/page.val.ts?p="locale"' as SourcePath]: [
        {
          message: "Did not validate locale.",
          fixes: ["locale:check-locale"],
          value: {
            locale,
            sourcePath: '/content/page.val.ts?p="locale"',
            aliases,
          },
        },
      ],
    };
  }

  const at = '/content/page.val.ts?p="locale"' as SourcePath;

  test("a declared language resolves away", () => {
    const result = resolveSchemaSourceFixes(
      unresolved("nb-NO"),
      project(["en-US", "nb-NO"]),
    );
    expect(result).toEqual({});
  });

  test("an undeclared language names the ones the project has", () => {
    const result = resolveSchemaSourceFixes(
      unresolved("sv-SE"),
      project(["en-US", "nb-NO"]),
    );
    expect(result[at][0].message).toBe(
      "'sv-SE' is not one of this project's languages: 'en-US', 'nb-NO'",
    );
    // Resolved: no fix code is left for anything downstream to try to apply.
    expect(result[at][0].fixes).toBeUndefined();
  });

  test("a project with no languages is told to declare them, not that the value is wrong", () => {
    const result = resolveSchemaSourceFixes(unresolved("nb-NO"), project([]));
    expect(result[at][0].message).toContain(
      "Declare them under 'locales.available'",
    );
  });

  test("a project with no settings module at all says the same", () => {
    const result = resolveSchemaSourceFixes(unresolved("nb-NO"), {
      schemas: {},
      sources: {},
    });
    expect(result[at][0].message).toContain(
      "Declare them under 'locales.available'",
    );
  });

  test("with aliases, a spelling resolves and the tag does not", () => {
    const snapshot = project(["en-US", "nb-NO"]);
    expect(
      resolveSchemaSourceFixes(unresolved("no", { "nb-NO": ["no"] }), snapshot),
    ).toEqual({});
    // The tag itself is no longer a value of this field — that is what makes
    // one page one URL.
    const rejected = resolveSchemaSourceFixes(
      unresolved("nb-NO", { "nb-NO": ["no"] }),
      snapshot,
    );
    expect(rejected[at][0].message).toBe(
      "'nb-NO' is not one of this field's locales: 'no'",
    );
  });

  test("a partial alias map is a subset of the project's languages", () => {
    const rejected = resolveSchemaSourceFixes(
      unresolved("fr", { "en-US": ["en"] }),
      project(["en-US", "fr-FR"]),
    );
    expect(rejected[at][0].message).toBe(
      "'fr' is not one of this field's locales: 'en'",
    );
  });

  test("an alias for a language the project does not have names the schema's mistake", () => {
    // The value stored here is fine — 'en' is a spelling this field accepts. It
    // is the map that is wrong, and saying so is the whole point: the previous
    // behaviour accepted '/de/…' as German on a site with no German.
    const rejected = resolveSchemaSourceFixes(
      unresolved("en", { "en-US": ["en"], "de-DE": ["de"] }),
      project(["en-US", "nb-NO"]),
    );
    expect(rejected[at][0].message).toBe(
      ".aliases() names 'de-DE', which is not one of this project's languages: " +
        "'en-US', 'nb-NO'. Add it under 'locales.available' in the settings " +
        "module, or drop it from the alias map.",
    );
    expect(rejected[at][0].fixes).toBeUndefined();
  });

  test("several undeclared aliases are named together, and read as a plural", () => {
    const rejected = resolveSchemaSourceFixes(
      unresolved("en", { "en-US": ["en"], "de-DE": ["de"], "sv-SE": ["sv"] }),
      project(["en-US"]),
    );
    expect(rejected[at][0].message).toBe(
      ".aliases() names 'de-DE', 'sv-SE', which are not among this project's " +
        "languages: 'en-US'. Add them under 'locales.available' in the settings " +
        "module, or drop them from the alias map.",
    );
  });

  test("an undeclared alias does not lend its spellings to the field", () => {
    // The same map, with the German spelling stored. Without the narrowing in
    // `acceptedLocaleValues` this resolved, and '/de/…' became a German page.
    const rejected = resolveSchemaSourceFixes(
      unresolved("de", { "en-US": ["en"], "de-DE": ["de"] }),
      project(["en-US"]),
    );
    expect(rejected[at][0].message).toContain(".aliases() names 'de-DE'");
  });

  test("a settings module of the wrong shape reads as no languages", () => {
    // Hand-edited, mid-keystroke: the resolver must not throw on its way past.
    expect(() =>
      resolveSchemaSourceFixes(unresolved("nb-NO"), project("en-US")),
    ).not.toThrow();
    expect(() =>
      resolveSchemaSourceFixes(unresolved("nb-NO"), project([1, null])),
    ).not.toThrow();
  });
});

/**
 * A marker error is one only the whole project can answer.
 *
 * Every caller that resolves any of them has to resolve all of them: what a
 * caller that misses one shows the user is the marker's own placeholder text —
 * "should typically be processed by Val internally … version mismatch" — which
 * is alarming and says nothing. Two of these leaked through `ValOps` exactly
 * that way, by being added here and not to a condition in the server.
 */
describe("isSchemaSourceFixError", () => {
  const markers: ValidationFix[] = [
    "keyof:check-keys",
    "router:check-route",
    "locale:check-locale",
    "record:fill-keys",
  ];

  test("every fix the resolver answers for is recognised as one", () => {
    for (const fix of markers) {
      expect(isSchemaSourceFixError({ message: "…", fixes: [fix] })).toBe(true);
    }
  });

  test("and it is the same set the resolver takes on", () => {
    // Pinned from the other end: a new marker fix that `resolveSchemaSourceFixForError`
    // answers for and this list does not is the leak, so the two are asserted
    // to agree rather than merely both existing.
    const snapshot = { schemas: {}, sources: {} };
    for (const fix of markers) {
      expect(
        resolveSchemaSourceFixForError(
          { message: "…", fixes: [fix] },
          snapshot,
        ),
      ).not.toBe(null);
    }
  });

  test("an ordinary validation error is not one", () => {
    expect(isSchemaSourceFixError({ message: "Expected 'string'" })).toBe(
      false,
    );
    expect(
      isSchemaSourceFixError({
        message: "…",
        fixes: ["image:check-remote"],
      }),
    ).toBe(false);
  });
});
