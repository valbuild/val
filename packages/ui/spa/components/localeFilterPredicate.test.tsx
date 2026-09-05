/** @jest-environment jsdom */
import { initVal } from "@valbuild/core";
import { renderHook } from "@testing-library/react";
import { ReactNode } from "react";
import {
  LocaleFilterProvider,
  useLocaleFilterPredicate,
} from "./LocaleFilterProvider";

const { s } = initVal();

const PROJECT_LOCALES = ["en-US", "nb-NO"];

jest.mock("../hooks/useProjectLocales", () => ({
  __esModule: true,
  useProjectLocales: () => PROJECT_LOCALES,
}));

function predicateUnder(locale: string | null) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LocaleFilterProvider locale={locale}>{children}</LocaleFilterProvider>
  );
  return renderHook(() => useLocaleFilterPredicate(), { wrapper }).result
    .current;
}

/**
 * What the filter hides, which is the whole of its contract.
 *
 * Only a node that OPENS a locale scope is ever filtered — everything else is
 * shown, always. That is what makes this a per-node check rather than a walk:
 * content inside a scope is reachable only through the node that opened it, so
 * hiding that node takes its subtree with it.
 */
describe("the locale filter predicate", () => {
  const localeKey = s.locale()["executeSerialize"]();
  const aliasedKey = s
    .locale()
    .aliases({ "nb-NO": "no" })
    ["executeSerialize"]();
  const stringKey = s.string()["executeSerialize"]();
  const scopedObject = s
    .object({ locale: s.locale(), title: s.string() })
    ["executeSerialize"]();
  const plainObject = s.object({ title: s.string() })["executeSerialize"]();

  test("with no filter, everything is shown", () => {
    const matches = predicateUnder(null);
    expect(matches({ key: "nb-NO", keySchema: localeKey })).toBe(true);
    expect(matches({ key: "en-US", keySchema: localeKey })).toBe(true);
  });

  test("a locale-keyed record shows only the selected language's entry", () => {
    const matches = predicateUnder("nb-NO");
    expect(matches({ key: "nb-NO", keySchema: localeKey })).toBe(true);
    expect(matches({ key: "en-US", keySchema: localeKey })).toBe(false);
  });

  test("an ordinary record is untouched: its keys say nothing about language", () => {
    const matches = predicateUnder("nb-NO");
    expect(matches({ key: "winter-jacket", keySchema: stringKey })).toBe(true);
  });

  test("aliases are resolved, so a '/no/…' key is Norwegian", () => {
    const matches = predicateUnder("nb-NO");
    expect(matches({ key: "no", keySchema: aliasedKey })).toBe(true);
    expect(matches({ key: "en", keySchema: aliasedKey })).toBe(true);
    // 'en' is not aliased in this map, so it resolves to no language at all —
    // and something in no language is always shown.
  });

  test("an object with a locale field is filtered by that field's value", () => {
    const matches = predicateUnder("nb-NO");
    expect(
      matches({
        schema: scopedObject,
        source: { locale: "nb-NO", title: "Vinterjakke" },
      }),
    ).toBe(true);
    expect(
      matches({
        schema: scopedObject,
        source: { locale: "en-US", title: "Winter jacket" },
      }),
    ).toBe(false);
  });

  test("an object with no locale field is always shown", () => {
    const matches = predicateUnder("nb-NO");
    expect(matches({ schema: plainObject, source: { title: "Jacket" } })).toBe(
      true,
    );
  });

  test("a locale field nobody has filled in stays listed", () => {
    // Hiding it would hide the field someone has to fill in to un-hide it.
    const matches = predicateUnder("nb-NO");
    expect(matches({ schema: scopedObject, source: { title: "x" } })).toBe(
      true,
    );
    expect(
      matches({ schema: scopedObject, source: { locale: null, title: "x" } }),
    ).toBe(true);
  });

  test("a filter naming a language the project does not have shows everything", () => {
    // A hand-edited link, or a language since removed. Neither should empty the
    // studio.
    const matches = predicateUnder("sv-SE");
    expect(matches({ key: "nb-NO", keySchema: localeKey })).toBe(true);
    expect(matches({ key: "en-US", keySchema: localeKey })).toBe(true);
  });
});
