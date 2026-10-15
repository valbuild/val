import {
  deepEqual,
  type JSONValue,
  type Operation,
} from "@valbuild/core/patch";

/**
 * The three-way merge of a module's content: where both sides started
 * (`base`), and each side's version. Pure JSON -- the schema decides nothing
 * here, and is checked afterwards (the schema check in `merge.ts`).
 *
 * The rules (valbuild/home `docs/hosted-publishing.md` step 8.2):
 *
 * - Changed on one side: that side's.
 * - Changed on both: a conflict -- even to the same value, which is an easy
 *   conflict to resolve but still one somebody decides.
 * - An object (a page, a record) merges key by key, so two keys changed on
 *   two sides combine.
 * - A list merges item by item only when neither side changed its shape: no
 *   item added, removed or moved. Otherwise positions mean different items on
 *   the two sides, and the whole list is the conflict.
 */

export type Value = JSONValue | undefined;

export type ValueConflict = {
  path: string[];
  base: Value;
  site: Value;
  proposal: Value;
};

export type Merged = {
  /**
   * Both sides combined. At a conflict it holds the site's value, until a
   * resolution replaces it.
   */
  value: Value;
  conflicts: ValueConflict[];
};

type JSONObject = { [key: string]: JSONValue };

function isObject(value: Value): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function same(a: Value, b: Value): boolean {
  if (a === undefined || b === undefined) return a === b;
  return deepEqual(a, b);
}

/**
 * Did this side add, remove or move an item? Lengths differ, or an item now
 * sits where it was not, while it is still what used to be somewhere else.
 */
export function reshaped(base: JSONValue[], side: JSONValue[]): boolean {
  if (base.length !== side.length) return true;
  return side.some(
    (item, at) =>
      !same(item, base[at]) &&
      base.some((was, from) => from !== at && same(item, was)),
  );
}

/**
 * Where a value is one value, though it is an object: a media value (its path
 * and what describes that file) or rich text. The schema says; see `merge.ts`.
 */
export type IsAtomic = (path: string[]) => boolean;

export function mergeValues(
  base: Value,
  site: Value,
  proposal: Value,
  atomic: IsAtomic = () => false,
  path: string[] = [],
): Merged {
  if (same(site, base)) return { value: proposal, conflicts: [] };
  if (same(proposal, base)) return { value: site, conflicts: [] };
  if (atomic(path)) {
    return { value: site, conflicts: [{ path, base, site, proposal }] };
  }

  if (isObject(base) && isObject(site) && isObject(proposal)) {
    const keys = [
      ...new Set([
        ...Object.keys(site),
        ...Object.keys(proposal),
        ...Object.keys(base),
      ]),
    ];
    const value: JSONObject = {};
    const conflicts: ValueConflict[] = [];
    for (const key of keys) {
      const merged = mergeValues(base[key], site[key], proposal[key], atomic, [
        ...path,
        key,
      ]);
      if (merged.value !== undefined) value[key] = merged.value;
      conflicts.push(...merged.conflicts);
    }
    return { value, conflicts };
  }

  if (
    Array.isArray(base) &&
    Array.isArray(site) &&
    Array.isArray(proposal) &&
    !reshaped(base, site) &&
    !reshaped(base, proposal)
  ) {
    const value: JSONValue[] = [];
    const conflicts: ValueConflict[] = [];
    base.forEach((item, at) => {
      const merged = mergeValues(item, site[at], proposal[at], atomic, [
        ...path,
        String(at),
      ]);
      // Neither side removed an item, so every position holds one.
      value.push(merged.value ?? null);
      conflicts.push(...merged.conflicts);
    });
    return { value, conflicts };
  }

  return { value: site, conflicts: [{ path, base, site, proposal }] };
}

/** `doc` with `value` at `path`; `undefined` removes it. `doc` is not changed. */
export function setAt(doc: Value, path: string[], value: Value): Value {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(doc)) {
    const copy = [...doc];
    const at = Number(head);
    const next = setAt(copy[at], rest, value);
    if (next === undefined) copy.splice(at, 1);
    else copy[at] = next;
    return copy;
  }
  const copy: JSONObject = isObject(doc) ? { ...doc } : {};
  const next = setAt(copy[head], rest, value);
  if (next === undefined) delete copy[head];
  else copy[head] = next;
  return copy;
}

export function valueAt(doc: Value, path: string[]): Value {
  let current = doc;
  for (const key of path) {
    if (Array.isArray(current)) current = current[Number(key)];
    else if (isObject(current)) current = current[key];
    else return undefined;
  }
  return current;
}

/**
 * The Val patch that turns `from` into `to`, as small as it can be: what
 * writes a merge into a `.val.ts` without rewriting what did not change.
 */
export function diffOps(
  from: Value,
  to: Value,
  path: string[] = [],
): Operation[] {
  if (same(from, to)) return [];
  if (isObject(from) && isObject(to)) {
    const ops: Operation[] = [];
    for (const key of Object.keys(from)) {
      if (!(key in to)) ops.push({ op: "remove", path: below(path, key) });
    }
    for (const [key, value] of Object.entries(to)) {
      ops.push(
        ...(key in from
          ? diffOps(from[key], value, [...path, key])
          : [add([...path, key], value)]),
      );
    }
    return ops;
  }
  if (Array.isArray(from) && Array.isArray(to) && from.length === to.length) {
    return from.flatMap((item, at) =>
      diffOps(item, to[at], [...path, String(at)]),
    );
  }
  return [{ op: "replace", path, value: to ?? null }];
}

function add(path: string[], value: JSONValue): Operation {
  return { op: "add", path, value };
}

function below(path: string[], key: string): [string, ...string[]] {
  return path.length === 0 ? [key] : [path[0], ...path.slice(1), key];
}
