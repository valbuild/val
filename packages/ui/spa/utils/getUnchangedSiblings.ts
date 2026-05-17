import {
  Internal,
  Json,
  ModuleFilePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { ChangeTreeNode } from "./computeChangedSourcePaths";

export type UnchangedSibling = {
  key: string;
  sourcePath: SourcePath;
};

/**
 * Returns sibling keys that are NOT in the change tree at this level,
 * ordered by schema (object) or source (record/array) position.
 *
 * The `changedChildKeys` should contain the unquoted segment strings as
 * returned by `getSegment()` from computeChangedSourcePaths — i.e. the
 * raw key for object/record children or the bare digit string for arrays.
 */
export function getUnchangedSiblings(
  parentSourcePath: SourcePath | ModuleFilePath,
  parentSchema: SerializedSchema,
  parentSource: Json,
  changedChildKeys: Set<string>,
): UnchangedSibling[] {
  const allKeys = getAllChildKeys(parentSchema, parentSource);
  if (allKeys === null) return [];

  const result: UnchangedSibling[] = [];
  for (const key of allKeys) {
    if (changedChildKeys.has(key)) continue;

    const modulePath = Internal.patchPathToModulePath([key]);
    const childSourcePath = appendToSourcePath(parentSourcePath, modulePath);
    result.push({ key, sourcePath: childSourcePath });
  }
  return result;
}

function getAllChildKeys(
  schema: SerializedSchema,
  source: Json,
): string[] | null {
  switch (schema.type) {
    case "object":
      return Object.keys(schema.items);

    case "record":
      if (source !== null && typeof source === "object" && !Array.isArray(source)) {
        return Object.keys(source);
      }
      return null;

    case "array":
      if (Array.isArray(source)) {
        return Array.from({ length: source.length }, (_, i) => String(i));
      }
      return null;

    default:
      return null;
  }
}

function appendToSourcePath(
  parentPath: SourcePath | ModuleFilePath,
  modulePath: string,
): SourcePath {
  const pathStr = String(parentPath);
  const sepIdx = pathStr.indexOf("?p=");
  if (sepIdx === -1) {
    return `${pathStr}?p=${modulePath}` as SourcePath;
  }
  const existingModulePath = pathStr.slice(sepIdx + 3);
  if (!existingModulePath) {
    return `${pathStr.slice(0, sepIdx)}?p=${modulePath}` as SourcePath;
  }
  return `${pathStr.slice(0, sepIdx)}?p=${existingModulePath}.${modulePath}` as SourcePath;
}

export type OrderedItem =
  | { kind: "change"; node: ChangeTreeNode }
  | { kind: "chunk"; siblings: UnchangedSibling[] };

/**
 * Walks child keys in schema/source order (NOT alphabetical tree order) and
 * produces an interleaved list of change items and chunks of consecutive
 * unchanged siblings.
 */
export function buildOrderedItems(
  parentSchema: SerializedSchema,
  parentSource: Json,
  changedChildren: ChangeTreeNode[],
  unchanged: UnchangedSibling[],
): OrderedItem[] {
  const allKeys = getAllChildKeys(parentSchema, parentSource);
  if (allKeys === null) {
    return changedChildren.map((node) => ({ kind: "change", node }));
  }

  const childBySegment = new Map<string, ChangeTreeNode>();
  for (const child of changedChildren) {
    childBySegment.set(getLastSegmentRaw(child.sourcePath), child);
  }

  const unchangedSet = new Set(unchanged.map((s) => s.key));
  const unchangedByKey = new Map<string, UnchangedSibling>();
  for (const s of unchanged) {
    unchangedByKey.set(s.key, s);
  }

  const result: OrderedItem[] = [];
  let pendingChunk: UnchangedSibling[] = [];
  const allKeysSet = new Set(allKeys);

  for (const key of allKeys) {
    const changedChild = childBySegment.get(key);

    if (changedChild) {
      if (pendingChunk.length > 0) {
        result.push({ kind: "chunk", siblings: pendingChunk });
        pendingChunk = [];
      }
      result.push({ kind: "change", node: changedChild });
    } else if (unchangedSet.has(key)) {
      const sibling = unchangedByKey.get(key);
      if (sibling) {
        pendingChunk.push(sibling);
      }
    }
  }

  if (pendingChunk.length > 0) {
    result.push({ kind: "chunk", siblings: pendingChunk });
  }

  for (const child of changedChildren) {
    const seg = getLastSegmentRaw(child.sourcePath);
    if (!allKeysSet.has(seg)) {
      result.push({ kind: "change", node: child });
    }
  }

  return result;
}

function getLastSegmentRaw(sourcePath: SourcePath | ModuleFilePath): string {
  const path = String(sourcePath);
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    path as SourcePath,
  );
  if (!modulePath) {
    return path;
  }
  const segments = Internal.splitModulePath(
    modulePath as Parameters<typeof Internal.splitModulePath>[0],
  );
  return segments[segments.length - 1] ?? path;
}
