import { Json } from "@valbuild/core";
import { isJsonArray } from "../utils/isJsonArray";

/**
 * What the settings module says about how the Studio behaves here.
 *
 * Read out of a module's SOURCE, which arrives as `Json`, so every field is
 * checked rather than asserted — the same reason `readThemeSettings` does it: a
 * settings module is a file someone edits, and a settings module that is
 * currently invalid still has to render a Studio.
 */
export type StudioSettings = {
  /**
   * Whether editors are offered the guided tour.
   *
   * `null` is unset, which is NOT the same as `false` and is the reason this is
   * three-valued: unset means nobody has decided, and the offer stands. See
   * {@link isTourOffered}.
   */
  tour: boolean | null;
};

export const NO_STUDIO_SETTINGS: StudioSettings = { tour: null };

/** Reads the `studio` section out of a settings module's source. */
export function readStudioSettings(source: Json | undefined): StudioSettings {
  if (typeof source !== "object" || source === null || isJsonArray(source)) {
    return NO_STUDIO_SETTINGS;
  }
  const studio = source["studio"];
  if (typeof studio !== "object" || studio === null || isJsonArray(studio)) {
    return NO_STUDIO_SETTINGS;
  }
  return {
    tour: typeof studio["tour"] === "boolean" ? studio["tour"] : null,
  };
}

/**
 * Whether the project offers the tour at all.
 *
 * Only an explicit `false` turns it off. Unset is yes, because the person the
 * tour exists for is the one who has not answered any question yet — and so is
 * a settings module that is missing, ambiguous or still loading, since "we do
 * not know yet" must not silently mean "no" for every project that never
 * touched this.
 */
export function isTourOffered(settings: StudioSettings): boolean {
  return settings.tour !== false;
}
