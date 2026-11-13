import {
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import type { array } from "@valbuild/core/fp";
import type { JSONValue, Patch } from "@valbuild/core/patch";
import type { ValCanvasComponentEdit } from "@valbuild/shared/internal";

/**
 * The patch path of the item at `index` of the list at `listPath`. Never
 * empty, which a `move` and a `remove` need said: it ends in the index.
 */
function itemPatchPathOf(
  listPath: string[],
  index: number,
): array.NonEmptyArray<string> {
  const [first, ...rest] = [...listPath, index.toString()];
  return first === undefined ? [index.toString()] : [first, ...rest];
}

/**
 * An edit to a list of components, asked for on the page
 * (`ValComponentEditor`), as the patch that makes it.
 *
 * The same ops the list's own field writes - a drag in the Studio's list and
 * a drag on the page are one edit - with the indices the page gave.
 */
export function componentEditPatch(
  edit: Exclude<ValCanvasComponentEdit, { op: "insert" }>,
): { moduleFilePath: ModuleFilePath; patch: Patch } {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(edit.list);
  const listPath = Internal.createPatchPath(modulePath);
  if (edit.op === "move") {
    return {
      moduleFilePath,
      patch: [
        {
          op: "move",
          from: itemPatchPathOf(listPath, edit.from),
          path: itemPatchPathOf(listPath, edit.to),
        },
      ],
    };
  }
  return {
    moduleFilePath,
    patch: [{ op: "remove", path: itemPatchPathOf(listPath, edit.index) }],
  };
}

/** The patch that puts `value` into `list` at `index`, and where it lands. */
export function componentInsertPatch(
  list: SourcePath,
  index: number,
  value: JSONValue,
): { moduleFilePath: ModuleFilePath; patch: Patch; itemPath: SourcePath } {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(list);
  const itemPatchPath = itemPatchPathOf(
    Internal.createPatchPath(modulePath),
    index,
  );
  return {
    moduleFilePath,
    patch: [{ op: "add", path: itemPatchPath, value }],
    itemPath: Internal.joinModuleFilePathAndModulePath(
      moduleFilePath,
      Internal.patchPathToModulePath(itemPatchPath),
    ),
  };
}

/**
 * The schema of what a list holds, or `null` when the path is not a list - a
 * page that is ahead of or behind this Studio's schemas can ask to add to
 * one. A union is one schema here: a new item starts as its first variant,
 * and the editor picks another in its field.
 */
export function listItemSchemaOf(
  list: SerializedSchema,
): SerializedSchema | null {
  return list.type === "array" ? list.item : null;
}
