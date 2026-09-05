import { initVal } from "../initVal";
import {
  acceptedLocaleValues,
  localeOfValue,
  spellingsOf,
  undeclaredAliasedLocales,
} from "../locale";
import { SourcePath } from "../val";
import { deserializeSchema } from "./deserialize";
import { locale } from "./locale";

const { s, c } = initVal();

describe("LocaleSchema", () => {
  test("a string defers to the settings module rather than deciding here", () => {
    // Which languages exist is in another module, so the schema cannot answer.
    // It emits the fix that `resolveSchemaSourceFixes` resolves, exactly as
    // `keyOf` and `route` do.
    const res = locale()["executeValidate"]("path" as SourcePath, "nb-NO");
    if (res === false) {
      throw new Error("expected the locale to defer to the settings module");
    }
    const error = res["path" as SourcePath][0];
    expect(error.fixes).toEqual(["locale:check-locale"]);
    expect(error.value).toMatchObject({ locale: "nb-NO" });
  });

  test("a non-string is wrong here, without needing the settings module", () => {
    const res = locale()["executeValidate"]("path" as SourcePath, 42 as never);
    expect(res && res["path" as SourcePath][0].message).toContain(
      "Expected 'string', got 'number'",
    );
  });

  test("nullable accepts null, and does not ask about it", () => {
    expect(
      locale()
        .nullable()
        ["executeValidate"]("path" as SourcePath, null),
    ).toEqual(false);
  });

  test("assert accepts a string and rejects the rest", () => {
    expect(
      locale()["executeAssert"]("path" as SourcePath, "nb-NO").success,
    ).toBe(true);
    expect(locale()["executeAssert"]("path" as SourcePath, 42).success).toBe(
      false,
    );
    expect(locale()["executeAssert"]("path" as SourcePath, null).success).toBe(
      false,
    );
    expect(
      locale()
        .nullable()
        ["executeAssert"]("path" as SourcePath, null).success,
    ).toBe(true);
  });

  test("serializes, and round-trips through deserialize", () => {
    const serialized = locale()
      .aliases({ "en-US": "en", "nb-NO": ["no", "nb"] })
      ["executeSerialize"]();
    expect(serialized).toMatchObject({
      type: "locale",
      // Normalised to arrays, so every reader sees one shape.
      aliases: { "en-US": ["en"], "nb-NO": ["no", "nb"] },
      opt: false,
    });
    expect(deserializeSchema(serialized)["executeSerialize"]()).toEqual(
      serialized,
    );
  });

  test("the alias table travels in the validation error, for the resolver", () => {
    const res = locale()
      .aliases({ "nb-NO": "no" })
      ["executeValidate"]("path" as SourcePath, "no");
    expect(res && res["path" as SourcePath][0].value).toMatchObject({
      locale: "no",
      aliases: { "nb-NO": ["no"] },
    });
  });

  test("readonly and hidden survive a round trip", () => {
    const readonly = locale().readonly()["executeSerialize"]();
    expect(deserializeSchema(readonly)["executeSerialize"]().readonly).toBe(
      true,
    );
    const hidden = locale().hidden()["executeSerialize"]();
    expect(deserializeSchema(hidden)["executeSerialize"]().hidden).toBe(true);
  });

  test("s.locale() is a field, a record key, and a nullable field", () => {
    const asField = c.define(
      "/content/a.val.ts",
      s.object({ locale: s.locale(), title: s.string() }),
      { locale: "nb-NO", title: "Vinterjakke" },
    );
    const asKey = c.define(
      "/content/b.val.ts",
      s.record(s.locale(), s.object({ title: s.string() })),
      { "nb-NO": { title: "Vinterjakke" }, "en-US": { title: "Jacket" } },
    );
    expect(asField).toBeDefined();
    expect(asKey).toBeDefined();
  });
});

describe("alias resolution", () => {
  const aliases = {
    "en-US": ["us-sales", "us-support"],
    "nb-NO": "no",
  };

  test("a locale's spellings, in declaration order", () => {
    expect(spellingsOf(aliases, "en-US")).toEqual(["us-sales", "us-support"]);
    expect(spellingsOf(aliases, "nb-NO")).toEqual(["no"]);
    expect(spellingsOf(aliases, "fr-FR")).toEqual([]);
  });

  test("without aliases, the languages themselves are the values", () => {
    expect(acceptedLocaleValues(["en-US", "nb-NO"], undefined)).toEqual([
      "en-US",
      "nb-NO",
    ]);
  });

  test("with aliases, the spellings REPLACE the tag", () => {
    // The property the design turns on: if `nb-NO` were also accepted, one page
    // could exist at /no/foo and /nb-NO/foo.
    const accepted = acceptedLocaleValues(["en-US", "nb-NO", "fr-FR"], aliases);
    expect(accepted).toEqual(["us-sales", "us-support", "no"]);
    expect(accepted).not.toContain("nb-NO");
  });

  test("a partial map is a subset: no French here", () => {
    expect(acceptedLocaleValues(["en-US", "fr-FR"], { "en-US": "en" })).toEqual(
      ["en"],
    );
  });

  test("a map cannot be a superset: an undeclared language lends nothing", () => {
    // The map names German; the project has none. '/de/…' is not a key this
    // field accepts, so the mistake cannot become content while it is unfixed.
    expect(
      acceptedLocaleValues(["en-US"], { "en-US": "en", "de-DE": "de" }),
    ).toEqual(["en"]);
    expect(
      localeOfValue("de", ["en-US"], { "en-US": "en", "de-DE": "de" }),
    ).toBe(null);
  });

  test("the undeclared aliases are named, so the schema's mistake can be reported", () => {
    expect(
      undeclaredAliasedLocales(["en-US", "nb-NO"], {
        "en-US": "en",
        "de-DE": "de",
      }),
    ).toEqual(["de-DE"]);
    expect(undeclaredAliasedLocales(["en-US"], { "en-US": "en" })).toEqual([]);
    expect(undeclaredAliasedLocales(["en-US"], undefined)).toEqual([]);
  });

  test("a stored value resolves back to the language it means", () => {
    expect(localeOfValue("us-support", ["en-US"], aliases)).toBe("en-US");
    expect(localeOfValue("no", ["nb-NO"], aliases)).toBe("nb-NO");
    expect(localeOfValue("nb-NO", ["nb-NO"], aliases)).toBe(null);
    expect(localeOfValue("nb-NO", ["nb-NO"], undefined)).toBe("nb-NO");
    expect(localeOfValue("sv-SE", ["nb-NO"], undefined)).toBe(null);
  });
});
