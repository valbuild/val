import { initVal } from "../initVal";
import { nextAppRouter, tanstackRouter } from "../router";
import { SourcePath } from "../val";
import { deserializeSchema } from "./deserialize";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

const { s } = initVal();

const MODULE = "/src/routes/_site.{-$locale}.blog.$slug.val.ts" as SourcePath;
const keyPath = (key: string) => `${MODULE}?p=${JSON.stringify(key)}`;

const urlLocale = s
  .enum("nb")
  .nullable()
  .locales({ nb: "nb-NO" }, { null: "en-US" });
const page = s.object({ title: s.string() });

function errorsAt(result: ValidationErrors, path: string): ValidationError[] {
  return result ? (result[path as SourcePath] ?? []) : [];
}

/** The deferred "is this one of the project's languages?" checks, by path. */
function localeChecks(result: ValidationErrors): Record<string, unknown[]> {
  const checks: Record<string, unknown[]> = {};
  for (const [path, errors] of Object.entries(result || {})) {
    for (const error of errors) {
      if (error.fixes?.includes("locale:check-locale")) {
        (checks[path] ??= []).push((error.value as { locale: string }).locale);
      }
    }
  }
  return checks;
}

/** Everything except the deferred locale checks. */
function otherErrors(result: ValidationErrors): Record<string, string[]> {
  const others: Record<string, string[]> = {};
  for (const [path, errors] of Object.entries(result || {})) {
    for (const error of errors) {
      if (!error.fixes?.includes("locale:check-locale")) {
        (others[path] ??= []).push(error.message);
      }
    }
  }
  return others;
}

describe("s.router(router, params, item)", () => {
  const schema = s.router(
    tanstackRouter,
    { locale: urlLocale, slug: s.string().maxLength(10) },
    page,
  );

  test("each key's parameters are checked against their schema, by name", () => {
    const result = schema["executeValidate"](MODULE, {
      "/blog/hello": { title: "Hello" },
      "/nb/blog/hei": { title: "Hei" },
    });
    expect(otherErrors(result)).toEqual({});
    // The language each page is in, checked against the settings module the
    // same way an s.locale() value is: a URL without the segment is the
    // `null` mapping's language.
    expect(localeChecks(result)).toEqual({
      [keyPath("/blog/hello")]: ["en-US"],
      [keyPath("/nb/blog/hei")]: ["nb-NO"],
    });
  });

  test("a value the parameter does not allow is a key error", () => {
    const result = schema["executeValidate"](MODULE, {
      "/fr/blog/bonjour": { title: "Bonjour" },
      "/blog/far-too-long-slug": { title: "Long" },
    });
    const fr = errorsAt(result, keyPath("/fr/blog/bonjour"));
    expect(fr.map((each) => each.message)).toEqual([
      'Value must be one of the following: "nb"',
    ]);
    expect(fr[0].keyError).toBe(true);
    expect(
      errorsAt(result, keyPath("/blog/far-too-long-slug")).some((each) =>
        each.message.includes("at most 10"),
      ),
    ).toBe(true);
  });

  test("a parameter the route does not have is a schema error", () => {
    const misnamed = s.router(tanstackRouter, { lang: urlLocale }, page);
    const result = misnamed["executeValidate"](MODULE, {});
    const errors = errorsAt(result, MODULE);
    expect(errors).toHaveLength(1);
    expect(errors[0].schemaError).toBe(true);
    expect(errors[0].message).toContain("There is no 'lang' in this route");
    expect(errors[0].message).toContain("'locale', 'slug'");
  });

  test("{ null } on a segment the route always has is a schema error", () => {
    const required = "/src/routes/$locale.blog.$slug.val.ts" as SourcePath;
    const result = schema["executeValidate"](required, {
      "/nb/blog/hei": { title: "Hei" },
    });
    expect(
      errorsAt(result, required).map((each) => [
        each.schemaError,
        each.message.startsWith("'locale' says which language"),
      ]),
    ).toEqual([[true, true]]);
  });

  test("leaving out a segment its schema does not allow is an error on the key", () => {
    const strict = s.router(
      tanstackRouter,
      { locale: s.enum("nb", "en").locales({ nb: "nb-NO", en: "en-US" }) },
      page,
    );
    const result = strict["executeValidate"](MODULE, {
      "/blog/hello": { title: "Hello" },
    });
    expect(
      errorsAt(result, keyPath("/blog/hello")).map((each) => each.message),
    ).toEqual([
      "This URL leaves out 'locale', which its schema does not allow. Make the schema .nullable(), or make the segment required in the route file.",
    ]);
  });

  test("a URL without the locale, and no { null } to say what that is, is an error", () => {
    const noDefault = s.router(
      tanstackRouter,
      { locale: s.enum("nb").nullable().locales({ nb: "nb-NO" }) },
      page,
    );
    const result = noDefault["executeValidate"](MODULE, {
      "/blog/hello": { title: "Hello" },
    });
    expect(otherErrors(result)[keyPath("/blog/hello")]).toEqual([
      'This URL leaves the language out, and nothing says which language that is. Add it to .locales(): .locales({ … }, { null: "en-US" })',
    ]);
  });

  test("keys that do not match the route are left to the router", () => {
    const result = schema["executeValidate"](MODULE, {
      "/nb/news/hei": { title: "Hei" },
    });
    expect(otherErrors(result)[keyPath("/nb/news/hei")]).toEqual([
      `URL path "/nb/news/hei" does not match the route pattern for "${MODULE}"`,
    ]);
  });

  test("works with the Next router too", () => {
    const next = s.router(
      nextAppRouter,
      { locale: s.enum("nb", "en").locales({ nb: "nb-NO", en: "en-US" }) },
      page,
    );
    const path = "/app/[locale]/about/page.val.ts" as SourcePath;
    const result = next["executeValidate"](path, {
      "/nb/about": { title: "Om oss" },
      "/en/about": { title: "About" },
    });
    expect(otherErrors(result)).toEqual({});
    expect(Object.values(localeChecks(result))).toEqual([["nb-NO"], ["en-US"]]);
  });

  test("a router whose keys are not routes cannot have parameters", () => {
    const external = s.router(
      // The external router has no route patterns.
      { getRouterId: () => "external-url-router", validate: () => [] },
      { locale: urlLocale },
      page,
    );
    const result = external["executeValidate"](MODULE, {});
    expect(errorsAt(result, MODULE)[0].schemaError).toBe(true);
  });

  test("only one parameter can be a locale", () => {
    const two = s.router(
      tanstackRouter,
      {
        locale: urlLocale,
        slug: s.enum("x").locales({ x: "en-GB" }),
      },
      page,
    );
    const result = two["executeValidate"](MODULE, {});
    expect(errorsAt(result, MODULE).map((each) => each.message)).toContain(
      "A page is in one language, so one route parameter can be a locale. Found 'locale', 'slug'.",
    );
  });

  test("a locale parameter makes each page a locale scope", () => {
    const nested = s.router(
      tanstackRouter,
      { locale: urlLocale },
      s.object({ language: s.locale(), title: s.string() }),
    );
    const result = nested["executeValidate"](MODULE, {});
    expect(
      errorsAt(result, MODULE).some(
        (each) =>
          each.schemaError && each.message.includes("cannot set another"),
      ),
    ).toBe(true);
  });

  test("serializes the parameters, and validates the same once deserialized", () => {
    const serialized = schema["executeSerialize"]();
    expect(serialized.params?.locale).toMatchObject({
      type: "enum",
      values: ["nb"],
      locales: { nb: "nb-NO" },
      nullLocale: "en-US",
      opt: true,
    });
    expect(serialized.params?.slug).toMatchObject({ type: "string" });
    const roundTripped = deserializeSchema(serialized);
    expect(roundTripped["executeSerialize"]()).toEqual(serialized);
    const source = {
      "/blog/hello": { title: "Hello" },
      "/fr/blog/bonjour": { title: "Bonjour" },
    };
    expect(roundTripped["executeValidate"](MODULE, source)).toEqual(
      schema["executeValidate"](MODULE, source),
    );
  });
});

describe("s.enum(...).locales(...)", () => {
  const PATH = '/content.val.ts?p="language"' as SourcePath;

  test("a field's value is checked as the language it means", () => {
    const field = s.enum("en", "nb").locales({ en: "en-US", nb: "nb-NO" });
    expect(localeChecks(field["executeValidate"](PATH, "nb"))).toEqual({
      [PATH]: ["nb-NO"],
    });
  });

  test("an object with one is in that language", () => {
    const nested = s.object({
      language: s.enum("en").locales({ en: "en-US" }),
      blocks: s.array(s.object({ locale: s.locale() })),
    });
    const result = nested["executeValidate"]("/a.val.ts" as SourcePath, {
      language: "en",
      blocks: [],
    });
    expect(
      Object.values(result || {})
        .flat()
        .some((each) => each.message.includes("cannot set another")),
    ).toBe(true);
  });

  test("{ null } is refused on a field: null there means nobody chose", () => {
    const field = urlLocale;
    const errors = errorsAt(field["executeValidate"](PATH, null), PATH);
    expect(errors).toHaveLength(1);
    expect(errors[0].schemaError).toBe(true);
    expect(errors[0].message).toContain("belongs on a router parameter");
  });

  test("a null field without { null } is not chosen, and is not checked", () => {
    const field = s.enum("nb").nullable().locales({ nb: "nb-NO" });
    expect(field["executeValidate"](PATH, null)).toBe(false);
  });

  test("tags must be canonical, and each language has one spelling", () => {
    const wrong = s
      .enum("en", "us")
      .nullable()
      .locales({ en: "en-US", us: "en_us" }, { null: "en-US" });
    const messages = errorsAt(wrong["executeValidate"](PATH, "en"), PATH)
      .filter((each) => each.schemaError)
      .map((each) => each.message);
    expect(messages).toContain(
      "'en_us' is not a language tag. Language then region, separated by a hyphen — 'nb-NO', not 'nb_NO'",
    );
    expect(messages).toContain(
      "'en-US' is in .locales() twice. Each language has one spelling, so a page has one URL per language.",
    );
  });

  test("a mapping that misses or invents a value is a schema error", () => {
    // Only reachable from JSON: the type requires exactly the enum's values.
    const fromJson = deserializeSchema({
      type: "enum",
      values: ["en", "nb"],
      locales: { en: "en-US", sv: "sv-SE" },
      opt: false,
    });
    const messages = errorsAt(fromJson["executeValidate"](PATH, "en"), PATH)
      .filter((each) => each.schemaError)
      .map((each) => each.message);
    expect(messages).toEqual([
      '.locales() does not say which language "nb" is',
      '.locales() names "sv", which is not one of this enum\'s values',
    ]);
  });
});
