import { useCallback } from "react";
import { ModuleFilePath } from "@valbuild/core";
import { JSONValue } from "@valbuild/core/patch";
import {
  useAddPatch,
  useShallowSourceAtPath,
} from "../components/ValFieldProvider";
import { sourcePathOfItem } from "../utils/sourcePathOfItem";

/**
 * Write one field of one settings section, creating the section if it is absent.
 *
 * The rule this exists for: a `replace` at `[section, field]` fails when there
 * is nothing at `section` to replace a key inside, and `{}` is the normal state
 * of a fresh settings module — the whole point of `s.settings()` being that
 * every key is optional. So the first write writes the SECTION, with the other
 * fields as `null`: unset, and explicitly so, which is what an absent key means
 * to the schema too.
 *
 * Generic over the section because it is true of every one of them. The
 * assistant needed it first and the locales section needs exactly the same
 * thing, and the version of this that lived in one section's hook would have
 * been copied rather than shared.
 */
export function useWriteSettingsSection<Field extends string>(
  moduleFilePath: ModuleFilePath,
  section: string,
  /** Every field the section has, so the ones not being written can be nulled. */
  fields: readonly Field[],
): (field: Field, value: JSONValue) => void {
  const { addPatch } = useAddPatch(moduleFilePath);
  const sectionPath = sourcePathOfItem(moduleFilePath, section);
  const current = useShallowSourceAtPath(sectionPath, "settings");
  const hasSection =
    current.status === "success" && "data" in current && !!current.data;
  return useCallback(
    (field: Field, value: JSONValue) => {
      if (hasSection) {
        addPatch([{ op: "add", path: [section, field], value }], "settings");
        return;
      }
      const others: Record<string, null> = {};
      for (const key of fields) {
        if (key !== field) {
          others[key] = null;
        }
      }
      addPatch(
        [{ op: "add", path: [section], value: { ...others, [field]: value } }],
        "settings",
      );
    },
    // `fields` is in here rather than assumed stable: both call sites pass a
    // module-level constant, so it costs nothing, and a caller that one day
    // passes a literal gets a correct callback instead of a stale one.
    [addPatch, hasSection, section, fields],
  );
}
