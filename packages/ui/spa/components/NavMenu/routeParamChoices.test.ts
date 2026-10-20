import { initVal } from "@valbuild/core";
import { routeParamChoices } from "./routeParamChoices";

const { s } = initVal();

describe("routeParamChoices", () => {
  const urlLocale = s
    .enum("nb")
    .nullable()
    .locales({ nb: "nb-NO" }, { null: "en-US" })
    ["executeSerialize"]();

  test("a language parameter lists its languages, each with what it puts in the URL", () => {
    const picked = routeParamChoices(urlLocale, true, []);
    expect(picked?.kind).toBe("locale");
    expect(picked?.choices.map((choice) => choice.value)).toEqual(["", "nb"]);
    // The language comes first and the URL segment after it. Exact names come
    // from `Intl.DisplayNames`, so only their shape is pinned here.
    expect(picked?.choices[0].label).toMatch(/ — no prefix$/);
    expect(picked?.choices[1].label).toMatch(/ — \/nb$/);
  });

  test("a segment the route always has offers no 'left out' choice", () => {
    expect(
      routeParamChoices(urlLocale, false, [])?.choices.map(
        (choice) => choice.value,
      ),
    ).toEqual(["nb"]);
  });

  test("leaving the segment out is offered only where { null } names its language", () => {
    const noDefault = s
      .enum("nb", "en")
      .nullable()
      .locales({ nb: "nb-NO", en: "en-US" })
      ["executeSerialize"]();
    expect(
      routeParamChoices(noDefault, true, [])?.choices.map(
        (choice) => choice.value,
      ),
    ).toEqual(["nb", "en"]);
  });

  test("s.locale() lists the project's languages", () => {
    const picked = routeParamChoices(s.locale()["executeSerialize"](), false, [
      "en-US",
      "nb-NO",
    ]);
    expect(picked?.kind).toBe("locale");
    expect(picked?.choices.map((choice) => choice.value)).toEqual([
      "en-US",
      "nb-NO",
    ]);
  });

  test("a plain enum is a list of its values, not of languages", () => {
    expect(
      routeParamChoices(
        s.enum("typescript", "python")["executeSerialize"](),
        false,
        [],
      ),
    ).toEqual({
      kind: "values",
      choices: [
        { value: "typescript", label: "typescript" },
        { value: "python", label: "python" },
      ],
    });
  });

  test("a string, or no schema at all, is free text", () => {
    expect(routeParamChoices(s.string()["executeSerialize"](), false, [])).toBe(
      null,
    );
    expect(routeParamChoices(undefined, false, [])).toBe(null);
  });
});
