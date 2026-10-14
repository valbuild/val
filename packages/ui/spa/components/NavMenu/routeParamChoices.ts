import type { SerializedSchema } from "@valbuild/core";
import { localeName } from "../../utils/localeName";

/**
 * One value a route parameter can take, as the new-page form offers it.
 *
 * `value` is what goes into the URL — `""` for an optional segment left out —
 * and `label` is what the editor reads. A locale's label leads with the
 * language, because "norsk bokmål" is what the person picking it is choosing,
 * and ends with what that does to the URL.
 */
export type RouteParamChoice = { value: string; label: string };

/**
 * A route parameter's closed set of values: a language (an `s.locale()`, or an
 * enum `.locales()` made one) or a plain enum.
 */
export type RouteParamChoices = {
  kind: "locale" | "values";
  choices: RouteParamChoice[];
};

/**
 * The values a route parameter can take, or `null` when it is free text.
 *
 * A closed set gets a picker rather than an input, so a value the router would
 * reject cannot be typed in the first place:
 *
 * - an `s.enum(...)` — its values, each named by the language `.locales()` maps
 *   it to, where it does;
 * - an `s.locale()` — the project's languages;
 * - and for either, when the URL may leave the segment out AND the schema
 *   allows that (`.nullable()`), the segment left out, named by the language
 *   `{ null: tag }` says such a URL is in.
 *
 * Anything else — a string, a parameter with no schema — is free text, as it
 * was.
 */
export function routeParamChoices(
  schema: SerializedSchema | undefined,
  segmentIsOptional: boolean,
  projectLocales: readonly string[],
): RouteParamChoices | null {
  if (schema === undefined) {
    return null;
  }
  const canBeLeftOut = segmentIsOptional && schema.opt;
  if (schema.type === "enum") {
    const locales = schema.locales;
    const tagOf = (value: string): string | undefined =>
      locales !== undefined &&
      Object.prototype.hasOwnProperty.call(locales, value)
        ? locales[value]
        : undefined;
    const choices: RouteParamChoice[] = schema.values.map((value) => {
      const tag = tagOf(value);
      return { value, label: tag === undefined ? value : named(tag, value) };
    });
    if (locales === undefined) {
      return {
        kind: "values",
        choices: canBeLeftOut
          ? [{ value: "", label: "None" }, ...choices]
          : choices,
      };
    }
    // Left out only where `{ null: tag }` says which language that is: without
    // it the router reports every URL that leaves the segment out, so offering
    // one would offer an error.
    return {
      kind: "locale",
      choices:
        canBeLeftOut && schema.nullLocale !== undefined
          ? [{ value: "", label: named(schema.nullLocale, "") }, ...choices]
          : choices,
    };
  }
  if (schema.type === "locale") {
    const choices: RouteParamChoice[] = projectLocales.map((tag) => ({
      value: tag,
      label: named(tag, tag),
    }));
    return {
      kind: "locale",
      choices: canBeLeftOut
        ? [{ value: "", label: "No prefix" }, ...choices]
        : choices,
    };
  }
  return null;
}

/**
 * `norsk bokmål (Norge) — /nb`, or `American English — no prefix`.
 *
 * The language first, in its own words (see `localeName`), and the tag where
 * `Intl` has no name for it; then the segment it puts in the URL.
 */
function named(tag: string, segment: string): string {
  const language = localeName(tag) ?? tag;
  return `${language} — ${segment === "" ? "no prefix" : `/${segment}`}`;
}
