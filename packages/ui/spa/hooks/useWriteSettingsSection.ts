import { useCallback } from "react";
import { ModuleFilePath } from "@valbuild/core";
import { JSONValue, Operation } from "@valbuild/core/patch";
import {
  useAddPatch,
  useShallowSourceAtPath,
} from "../components/ValFieldProvider";
import { sourcePathOfItem } from "../utils/sourcePathOfItem";

/**
 * Write settings fields, creating the section if it is absent.
 *
 * The rule this exists for: a `replace` at `[section, field]` fails when there
 * is nothing at `section` to replace a key inside, and `{}` is the normal state
 * of a fresh settings module — the whole point of `s.settings()` being that
 * every key is optional. So the first write writes the SECTION, with the other
 * fields as `null`: unset, and explicitly so, which is what an absent key means
 * to the schema too.
 *
 * Takes a SET of fields rather than one, because "the section does not exist
 * yet" and "two fields changed together" meet: adding the first language sets
 * `available` and `default` at once, and as two calls the second would rebuild
 * the section — `hasSection` is read from the store, so it is still false when
 * the second call is made — and write `available: null` over the language just
 * added. One call is one patch, so there is nothing to race.
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
): (changes: Partial<Record<Field, JSONValue>>) => void {
  const { addPatch } = useAddPatch(moduleFilePath);
  const sectionPath = sourcePathOfItem(moduleFilePath, section);
  const current = useShallowSourceAtPath(sectionPath, "settings");
  const hasSection =
    current.status === "success" && "data" in current && !!current.data;
  return useCallback(
    (changes: Partial<Record<Field, JSONValue>>) => {
      // Walked as `fields` rather than as the changes' own keys: it keeps the
      // declared order, and it is what lets a field be told apart from one that
      // is merely absent without a cast off `Object.entries`.
      const changed = fields.filter((field) =>
        Object.prototype.hasOwnProperty.call(changes, field),
      );
      if (changed.length === 0) {
        return;
      }
      if (hasSection) {
        addPatch(
          changed.map(
            (field): Operation => ({
              op: "add",
              path: [section, field],
              value: changes[field] ?? null,
            }),
          ),
          "settings",
        );
        return;
      }
      const value: Record<string, JSONValue> = {};
      for (const field of fields) {
        value[field] = changes[field] ?? null;
      }
      addPatch([{ op: "add", path: [section], value }], "settings");
    },
    // `fields` is in here rather than assumed stable: both call sites pass a
    // module-level constant, so it costs nothing, and a caller that one day
    // passes a literal gets a correct callback instead of a stale one.
    [addPatch, hasSection, section, fields],
  );
}
