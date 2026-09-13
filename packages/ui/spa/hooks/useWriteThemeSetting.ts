import { useCallback } from "react";
import { ModuleFilePath } from "@valbuild/core";
import { useWriteSettingsSection } from "./useWriteSettingsSection";

/**
 * The theme's fields, in the order a new section is written with.
 *
 * `logo` is in the list even though nothing here writes it — `ImageField` does,
 * at its own source path. It has to be, and the reason is the patch semantics:
 * an image field writes `replace`, and a `replace` fails with "Cannot replace
 * object element which does not exist" for a key that is absent. So the
 * section-creating write has to leave a `logo: null` for it to replace.
 */
export const THEME_FIELDS = ["accent", "radius", "mode", "logo"] as const;

export type ThemeField = (typeof THEME_FIELDS)[number];

/**
 * Write one of the theme's settings, creating the section if it is absent.
 *
 * The rule about an absent section is not this section's — a `replace` at
 * `["theme", field]` fails when there is nothing at `theme` to replace a key
 * inside, and `{}` is the normal state of a fresh settings module — so it lives
 * in {@link useWriteSettingsSection} and this only says which fields the theme
 * has.
 */
export function useWriteThemeSetting(
  moduleFilePath: ModuleFilePath,
): (field: ThemeField, value: string | null) => void {
  const write = useWriteSettingsSection(moduleFilePath, "theme", THEME_FIELDS);
  // One field at a time: the Appearance tab's controls are independent, and
  // each of them is one editor action. The shared hook takes a set because the
  // locales section needs to write two together.
  return useCallback(
    (field: ThemeField, value: string | null) => {
      write({ [field]: value });
    },
    [write],
  );
}
