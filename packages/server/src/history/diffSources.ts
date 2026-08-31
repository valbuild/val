import { Internal, type ModuleFilePath, type SourcePath } from "@valbuild/core";
import { deepEqual, type JSONValue } from "@valbuild/core/patch";

/**
 * Where two versions of a module's source differ.
 *
 * A VALUE diff, which is a different question from the one
 * `computeChangedSourcePaths` answers in the Studio: that one reads patch OPS
 * to build a review tree of who changed what. History has two finished values
 * and no ops relating them - `after` vs `current` in particular are separated
 * by everything that happened since - so the ops are not available even in
 * principle.
 *
 * Reports the SHALLOWEST differing path. If an object was replaced wholesale,
 * that object is the change; enumerating every leaf beneath it would bury the
 * one fact worth showing. Recursion continues only where both sides are the
 * same kind of container, because that is the only case where "the same field,
 * changed" is a meaningful statement.
 *
 * Array elements are compared BY INDEX. Val identifies list items positionally
 * (`createValPathOfItem` takes an index), so an insertion at the front reads as
 * "everything after it changed". That is what the source path model can
 * express, and pretending otherwise would produce paths that point at the wrong
 * items.
 */
export function diffSources(
  moduleFilePath: ModuleFilePath,
  before: JSONValue | null,
  after: JSONValue | null,
): SourcePath[] {
  if (before === null && after === null) {
    return [];
  }
  const rootPath = moduleFilePath as unknown as SourcePath;
  if (before === null || after === null) {
    return [rootPath];
  }
  const paths: SourcePath[] = [];
  walk(rootPath, before, after, paths);
  return paths;
}

function pathOf(parent: SourcePath, key: string | number): SourcePath {
  const child = Internal.createValPathOfItem(parent, key);
  // createValPathOfItem returns undefined for a parent it cannot extend. Naming
  // the parent is then the honest answer: something under here changed, and
  // this is the deepest path that can be addressed.
  return child ?? parent;
}

function isPlainObject(
  value: JSONValue,
): value is { [key: string]: JSONValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(
  path: SourcePath,
  before: JSONValue,
  after: JSONValue,
  out: SourcePath[],
): void {
  if (deepEqual(before, after)) {
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index++) {
      if (index >= before.length || index >= after.length) {
        // Added or removed: the element itself is the change.
        out.push(pathOf(path, index));
        continue;
      }
      walk(pathOf(path, index), before[index], after[index], out);
    }
    return;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const beforeValue = before[key];
      const afterValue = after[key];
      if (beforeValue === undefined || afterValue === undefined) {
        out.push(pathOf(path, key));
        continue;
      }
      walk(pathOf(path, key), beforeValue, afterValue, out);
    }
    return;
  }
  // Different kinds, or two primitives that differ: this path is the change.
  out.push(path);
}
