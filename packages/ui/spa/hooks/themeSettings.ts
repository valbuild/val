import { Json, THEME_RADIUS_STEPS, ThemeRadius } from "@valbuild/core";
import { isJsonArray } from "../utils/isJsonArray";

/**
 * What the settings module says about the Studio's look.
 *
 * Read out of a module's SOURCE, which arrives as `Json`, so every field is
 * checked rather than asserted — the same reason `readAssistantSettings` does
 * it: a settings module is a file someone edits, and a hand-written one can
 * hold anything the schema has not yet rejected. A settings module that is
 * currently invalid still has to render a Studio.
 */
export type ThemeSettings = {
  /** A hex string, or `null` for Val's own green. Not validated here — see below. */
  accent: string | null;
  radius: ThemeRadius | null;
  /** The project's default, which never overrides an editor's own choice. */
  mode: "dark" | "light" | null;
  /**
   * The project's own mark, as a path and its alt text.
   *
   * A path rather than a URL: turning one into the other needs the patch id of
   * whatever uploaded it, which lives in a different store — see `refToUrl`.
   * Resolving it here would mean this function reading two stores instead of
   * being a pure read of one module's source.
   */
  logo: { path: string; alt: string | null } | null;
};

export const NO_THEME_SETTINGS: ThemeSettings = {
  accent: null,
  radius: null,
  mode: null,
  logo: null,
};

/**
 * Reads the `theme` section out of a settings module's source.
 *
 * `accent` is passed through as any non-empty string rather than checked for
 * hex here, because there is exactly one place that can answer "is this a
 * usable accent" and it is the thing that builds the ramp: `accentRamp` returns
 * `null` for anything it cannot parse, and `themeCustomProperties` then applies
 * nothing. Duplicating a weaker check here would mean two definitions of a
 * valid accent, and the weaker one would win.
 */
export function readThemeSettings(source: Json | undefined): ThemeSettings {
  if (typeof source !== "object" || source === null || isJsonArray(source)) {
    return NO_THEME_SETTINGS;
  }
  const theme = source["theme"];
  if (typeof theme !== "object" || theme === null || isJsonArray(theme)) {
    return NO_THEME_SETTINGS;
  }
  return {
    accent: nonEmptyString(theme["accent"]),
    radius: radiusOrNull(theme["radius"]),
    mode: modeOrNull(theme["mode"]),
    logo: logoOrNull(theme["logo"]),
  };
}

/**
 * The logo's path and alt text, or `null`.
 *
 * `path` is the only field required: a media value is `{ path, ... }` and
 * everything else on it — the dimensions, the mime type — was read from the
 * bytes and is not needed to draw it in a 32px box. An entry with no path is
 * not a half-usable logo, it is a `<img src="undefined">`.
 */
function logoOrNull(
  value: Json | undefined,
): { path: string; alt: string | null } | null {
  if (typeof value !== "object" || value === null || isJsonArray(value)) {
    return null;
  }
  const path = value["path"];
  if (typeof path !== "string" || path.trim() === "") {
    return null;
  }
  return { path, alt: nonEmptyString(value["alt"]) };
}

function nonEmptyString(value: Json | undefined): string | null {
  // An empty string is unset, as it is everywhere else in settings: it is a
  // value someone cleared, not a colour.
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function radiusOrNull(value: Json | undefined): ThemeRadius | null {
  // Checked against the list rather than cast: an unknown step from a
  // hand-edited file would otherwise be looked up in `THEME_RADIUS_LENGTHS` and
  // produce `--radius: undefined`, which takes the whole declaration down.
  return THEME_RADIUS_STEPS.find((step) => step === value) ?? null;
}

function modeOrNull(value: Json | undefined): "dark" | "light" | null {
  return value === "dark" || value === "light" ? value : null;
}
