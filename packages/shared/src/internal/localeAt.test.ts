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
    locales: { available, default: available[0] ?? null },
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

  test("the answer is the canonical tag, not the spelling the key uses", () => {
    // `<html lang>`, `Intl` and a comparison against `locales.available` all
    // want the tag; the key is `/no/…` because that is the URL.
    const page = c.define(
      "/content/page.val.ts",
      s.record(
        s.locale().aliases({ "en-US": "en", "nb-NO": "no" }),
        s.object({ title: s.string() }),
      ),
      { no: { title: "Vinterjakke" }, en: { title: "Jacket" } },
    );
    const snapshot = project(["en-US", "nb-NO"], [page]);
    expect(localeAt(AT('/content/page.val.ts?p="no"."title"'), snapshot)).toBe(
      "nb-NO",
    );
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
