import { initVal } from "../initVal";
import { localeOfValue } from "../locale";
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
    const serialized = locale()["executeSerialize"]();
    expect(serialized).toMatchObject({ type: "locale", opt: false });
    expect(deserializeSchema(serialized)["executeSerialize"]()).toEqual(
      serialized,
    );
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

describe("localeOfValue", () => {
  test("a value is the language it names, if the project declared it", () => {
    expect(localeOfValue("nb-NO", ["en-US", "nb-NO"])).toBe("nb-NO");
    expect(localeOfValue("sv-SE", ["en-US", "nb-NO"])).toBe(null);
    // Nothing is one of no languages — a project that has not declared any.
    expect(localeOfValue("nb-NO", [])).toBe(null);
  });
});
