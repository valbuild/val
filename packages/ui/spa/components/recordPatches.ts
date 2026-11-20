import type { JSONValue, Patch } from "@valbuild/core/patch";
import type { array } from "@valbuild/core/fp";

/**
 * What adding and deleting a record entry write: `AddRecordPopover` and
 * `DeleteRecordPopover`. Their own functions so the scenario harness
 * (`scenarios/`) writes exactly what those popovers write. A rename is
 * `renameRecordEntry` in `useRenameRecordEntry.ts`.
 */

/** A new entry at `key`, holding the item schema's empty value (`emptyOf`). */
export function recordAddPatch(
  recordPatchPath: string[],
  key: string,
  empty: JSONValue,
): Patch {
  return [{ op: "add", path: [...recordPatchPath, key], value: empty }];
}

/** The entry at `entryPatchPath`, removed. */
export function recordRemovePatch(
  entryPatchPath: array.NonEmptyArray<string>,
): Patch {
  return [{ op: "remove", path: entryPatchPath }];
}
