import {
  Internal,
  type ModuleFilePath,
  type SerializedObjectSchema,
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

/** One kind of item a list can take: a variant of its union. */
export type ComponentKind = {
  /** The variant's tag, which is also what it is called. */
  value: string;
  description?: string;
  schema: SerializedObjectSchema;
};

/**
 * What can be added to a list, from its schema.
 *
 * - `one`: the items are all of one schema, so there is nothing to ask.
 * - `kinds`: the items are a discriminated union, and the editor says which.
 * - `not-a-list`: the path is not an array, which a page that is ahead of or
 *   behind this Studio's schemas can ask for.
 */
export type ComponentChoices =
  | { status: "one"; schema: SerializedSchema }
  | { status: "kinds"; key: string; kinds: ComponentKind[] }
  | { status: "not-a-list" };

export function componentChoicesOf(list: SerializedSchema): ComponentChoices {
  if (list.type !== "array") {
    return { status: "not-a-list" };
  }
  const item = list.item;
  if (item.type !== "discriminated-union") {
    return { status: "one", schema: item };
  }
  const kinds: ComponentKind[] = [];
  for (const variant of item.items) {
    const tag = variant.items[item.key];
    if (tag?.type === "literal") {
      kinds.push({
        value: tag.value,
        ...(variant.description !== undefined
          ? { description: variant.description }
          : {}),
        schema: variant,
      });
    }
  }
  return { status: "kinds", key: item.key, kinds };
}
