import {
  Internal,
  initVal,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
  type ValModule,
} from "@valbuild/core";
import { localeAt } from "./localeAt";
import type { SchemaSourceSnapshot } from "./resolveSchemaSourceFixes";

const { s, c } = initVal();

function snapshotOf(valModules: ValModule<Source>[]): SchemaSourceSnapshot {
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

/** A project that declares `available`, plus the modules under test. */
function project(
  available: string[],
  valModules: ValModule<Source>[],
): SchemaSourceSnapshot {
  const settings = c.define("/settings.val.ts", s.settings(), {
    locales: { available },
  });
  return snapshotOf([settings, ...valModules]);
}

const AT = (path: string) => path as SourcePath;

describe("localeAt", () => {
  test("a locale field governs the object it is on, and everything below it", () => {
    const page = c.define(
      "/content/page.val.ts",
      s.object({
        locale: s.locale(),
        title: s.string(),
        body: s.object({ intro: s.string() }),
      }),
      { locale: "nb-NO", title: "Vinterjakke", body: { intro: "Varm." } },
    );
    const snapshot = project(["en-US", "nb-NO"], [page]);
    expect(localeAt(AT("/content/page.val.ts"), snapshot)).toBe("nb-NO");
    expect(localeAt(AT('/content/page.val.ts?p="title"'), snapshot)).toBe(
      "nb-NO",
    );
    expect(
      localeAt(AT('/content/page.val.ts?p="body"."intro"'), snapshot),
    ).toBe("nb-NO");
  });

  test("a locale-keyed record governs each entry, by its key", () => {
    const page = c.define(
      "/content/page.val.ts",
      s.record(s.locale(), s.object({ title: s.string() })),
      { "nb-NO": { title: "Vinterjakke" }, "en-US": { title: "Jacket" } },
    );
    const snapshot = project(["en-US", "nb-NO"], [page]);
    // The record itself is not in any one language — it holds all of them.
    expect(localeAt(AT("/content/page.val.ts"), snapshot)).toBe(null);
    expect(localeAt(AT('/content/page.val.ts?p="nb-NO"'), snapshot)).toBe(
      "nb-NO",
    );
    expect(
      localeAt(AT('/content/page.val.ts?p="en-US"."title"'), snapshot),
    ).toBe("en-US");
  });

  test("content outside any scope has no locale", () => {
    const page = c.define(
      "/content/page.val.ts",
      s.object({ title: s.string() }),
      { title: "Jacket" },
    );
    const snapshot = project(["en-US", "nb-NO"], [page]);
    expect(localeAt(AT('/content/page.val.ts?p="title"'), snapshot)).toBe(null);
  });

  test("a project with no languages has no locales to be in", () => {
    const page = c.define(
      "/content/page.val.ts",
      s.object({ locale: s.locale(), title: s.string() }),
      { locale: "nb-NO", title: "Vinterjakke" },
    );
    expect(
      localeAt(AT('/content/page.val.ts?p="title"'), project([], [page])),
    ).toBe(null);
  });

  test("a locale that is not one of the project's is not an answer", () => {
    // Validation is already reporting it. Guessing here would put a language
    // in `<html lang>` that nobody chose.
    const page = c.define(
      "/content/page.val.ts",
      s.object({ locale: s.locale(), title: s.string() }),
      { locale: "sv-SE", title: "Vinterjacka" },
    );
    const snapshot = project(["en-US", "nb-NO"], [page]);
    expect(localeAt(AT('/content/page.val.ts?p="title"'), snapshot)).toBe(null);
  });

  test("a scope reached through an array and a record", () => {
    const page = c.define(
      "/content/page.val.ts",
      s.record(
        s.string(),
        s.object({
          sections: s.array(s.object({ locale: s.locale(), text: s.string() })),
        }),
      ),
      {
        jacket: {
          sections: [
            { locale: "nb-NO", text: "Varm." },
            { locale: "en-US", text: "Warm." },
          ],
        },
      },
    );
    const snapshot = project(["en-US", "nb-NO"], [page]);
    expect(
      localeAt(
        AT('/content/page.val.ts?p="jacket"."sections".0."text"'),
        snapshot,
      ),
    ).toBe("nb-NO");
    expect(
      localeAt(
        AT('/content/page.val.ts?p="jacket"."sections".1."text"'),
        snapshot,
      ),
    ).toBe("en-US");
  });

  test("a scope inside an object union follows the branch the value takes", () => {
    const page = c.define(
      "/content/page.val.ts",
      s.object({
        block: s.union(
          "type",
          s.object({
            type: s.literal("quote"),
            locale: s.locale(),
            text: s.string(),
          }),
          s.object({ type: s.literal("image"), alt: s.string() }),
        ),
      }),
      { block: { type: "quote", locale: "nb-NO", text: "Varm." } },
    );
    const snapshot = project(["en-US", "nb-NO"], [page]);
    expect(
      localeAt(AT('/content/page.val.ts?p="block"."text"'), snapshot),
    ).toBe("nb-NO");
  });

  test("a path that STOPS at a scope answers with that scope", () => {
    // The block itself, not something inside it — which is the path the Studio
    // has when it draws a row, and the one a deep link carries.
    const page = c.define(
      "/content/page.val.ts",
      s.object({
        block: s.union(
          "type",
          s.object({
            type: s.literal("quote"),
            locale: s.locale(),
            text: s.string(),
          }),
          s.object({ type: s.literal("image"), alt: s.string() }),
        ),
        sections: s.array(s.object({ locale: s.locale(), text: s.string() })),
        byLocale: s.record(s.locale(), s.object({ title: s.string() })),
      }),
      {
        block: { type: "quote", locale: "nb-NO", text: "Varm." },
        sections: [{ locale: "en-US", text: "Warm." }],
        byLocale: { "nb-NO": { title: "Vinterjakke" } },
      },
    );
    const snapshot = project(["en-US", "nb-NO"], [page]);
    expect(localeAt(AT('/content/page.val.ts?p="block"'), snapshot)).toBe(
      "nb-NO",
    );
    expect(localeAt(AT('/content/page.val.ts?p="sections".0'), snapshot)).toBe(
      "en-US",
    );
    expect(
      localeAt(AT('/content/page.val.ts?p="byLocale"."nb-NO"'), snapshot),
    ).toBe("nb-NO");
  });

  test("a module that is not in the snapshot has no answer, and does not throw", () => {
    const snapshot = project(["en-US"], []);
    expect(localeAt(AT('/content/missing.val.ts?p="title"'), snapshot)).toBe(
      null,
    );
  });

  test("a path that does not exist in the schema stops where it ran out", () => {
    // Hand-typed, or left over from a rename. The scope found on the way down
    // still holds, which is the useful answer.
    const page = c.define(
      "/content/page.val.ts",
      s.object({ locale: s.locale(), title: s.string() }),
      { locale: "nb-NO", title: "Vinterjakke" },
    );
    const snapshot = project(["en-US", "nb-NO"], [page]);
    expect(
      localeAt(AT('/content/page.val.ts?p="gone"."deeper"'), snapshot),
    ).toBe("nb-NO");
  });
});

describe("localeAt with locales the URL names", () => {
  const urlLocale = s
    .enum("nb")
    .nullable()
    .locales({ nb: "nb-NO" }, { null: "en-US" });

  test("a router's locale parameter governs each page", () => {
    const blog = c.define(
      "/src/routes/{-$locale}.blog.$slug.val.ts",
      s.router(
        Internal.tanstackRouter,
        { locale: urlLocale, slug: s.string() },
        s.object({ title: s.string() }),
      ),
      {
        "/blog/hello": { title: "Hello" },
        "/nb/blog/hei": { title: "Hei" },
      },
    );
    const snapshot = project(["en-US", "nb-NO"], [blog]);
    const at = (key: string, field = "") =>
      localeAt(
        AT(
          `/src/routes/{-$locale}.blog.$slug.val.ts?p=${JSON.stringify(key)}${field}`,
        ),
        snapshot,
      );
    // The router itself is every language at once, so none of them.
    expect(
      localeAt(AT("/src/routes/{-$locale}.blog.$slug.val.ts"), snapshot),
    ).toBe(null);
    expect(at("/nb/blog/hei")).toBe("nb-NO");
    expect(at("/nb/blog/hei", '."title"')).toBe("nb-NO");
    // No segment: the language `{ null }` names.
    expect(at("/blog/hello")).toBe("en-US");
  });

  test("a mapped language that the project does not declare is no answer", () => {
    const blog = c.define(
      "/src/routes/{-$locale}.about.val.ts",
      s.router(
        Internal.tanstackRouter,
        { locale: urlLocale },
        s.object({ title: s.string() }),
      ),
      { "/nb/about": { title: "Om oss" } },
    );
    const snapshot = project(["en-US"], [blog]);
    expect(
      localeAt(
        AT('/src/routes/{-$locale}.about.val.ts?p="/nb/about"'),
        snapshot,
      ),
    ).toBe(null);
  });

  test("an enum field with .locales() is the language its value stands for", () => {
    const page = c.define(
      "/content/page.val.ts",
      s.object({
        language: s.enum("en", "nb").locales({ en: "en-US", nb: "nb-NO" }),
        title: s.string(),
      }),
      { language: "nb", title: "Vinterjakke" },
    );
    const snapshot = project(["en-US", "nb-NO"], [page]);
    expect(localeAt(AT('/content/page.val.ts?p="title"'), snapshot)).toBe(
      "nb-NO",
    );
  });
});
