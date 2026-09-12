import { initVal } from "@valbuild/core";
import { emptyOf } from "./emptyOf";

const { s } = initVal();

describe("emptyOf, for a record with a declared key set", () => {
  test("a literal-union record starts with every key, not empty", () => {
    // `{}` here would be content that fails validation the moment it is
    // written — TypeScript demanded both keys, and now so does the validator.
    const schema = s.record(
      s.union(s.literal("a"), s.literal("b")),
      s.string(),
    );
    expect(emptyOf(schema["executeSerialize"]())).toEqual({
      a: null,
      b: null,
    });
  });

  test("the entries are null, not an empty item", () => {
    // An object of empty strings claims someone wrote it and left it blank, and
    // would count as filled in by every list and filter downstream. Null is
    // "nobody has written this yet", which is what it is.
    const schema = s.record(
      s.union(s.literal("a"), s.literal("b")),
      s.object({ title: s.string() }),
    );
    expect(emptyOf(schema["executeSerialize"]())).toEqual({
      a: null,
      b: null,
    });
  });

  test("a locale record needs the project's languages, and is told them", () => {
    const schema = s.record(s.locale(), s.string());
    expect(
      emptyOf(schema["executeSerialize"](), { locales: ["en-US", "nb-NO"] }),
    ).toEqual({ "en-US": null, "nb-NO": null });
  });

  test("without the languages it is empty, which validation then reports", () => {
    // Honest rather than wrong: a caller that has not been given the project's
    // languages has not been given them, and inventing keys would be worse.
    const schema = s.record(s.locale(), s.string());
    expect(emptyOf(schema["executeSerialize"]())).toEqual({});
  });

  test("an open record still starts empty: no key anyone could mean", () => {
    const schema = s.record(s.string(), s.string());
    expect(emptyOf(schema["executeSerialize"]())).toEqual({});
    expect(emptyOf(s.record(s.string())["executeSerialize"]())).toEqual({});
  });

  test("a declared-key record nested in an object is filled in too", () => {
    const schema = s.object({
      title: s.string(),
      byLanguage: s.record(s.locale(), s.string()),
    });
    expect(
      emptyOf(schema["executeSerialize"](), { locales: ["en-US"] }),
    ).toEqual({ title: "", byLanguage: { "en-US": null } });
  });
});

describe("emptyOf and the language being worked in", () => {
  test("a locale field is created set to the one language in play", () => {
    // The point of the whole thing: adding an item while the Studio is
    // filtered to Norwegian gives a Norwegian item, not an invalid one that
    // vanishes from the list the moment it is written.
    const schema = s.object({ locale: s.locale(), title: s.string() });
    expect(
      emptyOf(schema["executeSerialize"](), {
        locales: ["en-US", "nb-NO"],
        selectedLocale: "nb-NO",
      }),
    ).toEqual({ locale: "nb-NO", title: "" });
  });

  test("with no language in play it is unset, and validation says so", () => {
    // NOT `locales[0]`: guessing would file content under a language nobody
    // chose, which is the state this feature exists to make visible.
    const schema = s.object({ locale: s.locale(), title: s.string() });
    expect(
      emptyOf(schema["executeSerialize"](), { locales: ["en-US", "nb-NO"] }),
    ).toEqual({ locale: "", title: "" });
  });

  test("it reaches a locale field however deep it is", () => {
    const schema = s.object({
      sections: s.array(s.object({ locale: s.locale() })),
    });
    // An array starts empty, so the field is reached through what CREATES a
    // row — the item schema — which is what the Studio's add paths pass.
    const item = s.object({ locale: s.locale() });
    expect(emptyOf(schema["executeSerialize"](), {})).toEqual({ sections: [] });
    expect(
      emptyOf(item["executeSerialize"](), { selectedLocale: "fr-FR" }),
    ).toEqual({ locale: "fr-FR" });
  });
});
