import { useCallback } from "react";
import { ModuleFilePath } from "@valbuild/core";
import {
  useAddPatch,
  useShallowSourceAtPath,
} from "../components/ValFieldProvider";
import { sourcePathOfItem } from "../utils/sourcePathOfItem";

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
 * Deliberately a near-copy of `useWriteAssistantSetting` rather than a shared
 * generic over both. The rule they have in common is one line — a `replace` at
 * `["theme", field]` fails when there is nothing at `theme` to replace a key
 * inside, and `{}` is the normal state of a fresh settings module — and the
 * thing that differs is the field list, which is the part that has to be
 * exhaustive per section. A generic version would take the field list as a
 * parameter and be the same length, with one more layer to read through.
 *
 * If a third section wants this, collapse all three then: by that point the
 * shape will have been demonstrated three times rather than guessed at twice.
 */
export function useWriteThemeSetting(
  moduleFilePath: ModuleFilePath,
): (field: ThemeField, value: string | null) => void {
  const { addPatch } = useAddPatch(moduleFilePath);
  const themePath = sourcePathOfItem(moduleFilePath, "theme");
  const section = useShallowSourceAtPath(themePath, "settings");
  const hasSection =
    section.status === "success" && "data" in section && !!section.data;
  return useCallback(
    (field: ThemeField, value: string | null) => {
      if (hasSection) {
        addPatch([{ op: "add", path: ["theme", field], value }], "settings");
        return;
      }
      const others: Record<string, null> = {};
      for (const key of THEME_FIELDS) {
        if (key !== field) {
          others[key] = null;
        }
      }
      addPatch(
        [{ op: "add", path: ["theme"], value: { ...others, [field]: value } }],
        "settings",
      );
    },
    [addPatch, hasSection],
  );
}
