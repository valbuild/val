import type { Operation } from "@valbuild/core/patch";
import { deepEqual, type JSONValue } from "@valbuild/core/patch";

/**
 * The ops that turn one value into another.
 *
 * Deliberately restricted: only `replace`, `add` and `remove`, never `move`,
 * `copy` or `test`. That is not minimalism for its own sake - it is what makes
 * the output safe to apply, and safe to SPLIT.
 *
 * ## Arrays, and why this looks the way it does
 *
 * `JSONOps` applies array ops with `splice`, so an `add` or a `remove` shifts
 * every index after it. A diff that emits several of those is order-sensitive,
 * and getting the order subtly wrong corrupts the list rather than failing.
 * `replace` is the exception: it assigns (`node[index] = value`) and shifts
 * nothing.
 *
 * So:
 *
 *   same length   - one `replace` per differing index. Order-independent, and
 *                   each index is its own restorable unit.
 *   length changed - one `replace` of the WHOLE array.
 *
 * Most edits inside a list keep its length (someone edits a field of an item),
 * so the common case gets per-item granularity for free. Adding or removing an
 * item coarsens to the list, which is honest: the list is what changed, and Val
 * identifies items positionally, so "the same item, moved" is not something the
 * source-path model can express anyway.
 *
 * ## Shallowest wins
 *
 * When something was replaced wholesale, that thing is the change. Descending
 * to enumerate every leaf beneath it would bury the one fact worth showing and
 * would produce a dozen restore units where there is one decision.
 *
 * ## Splitting
 *
 * Each op is independent of the others: no op's correctness depends on another
 * having been applied first. That is what lets the caller mint one patch per op
 * and offer them separately - see computeRestorePatches.
 */
export function diffToOps(from: JSONValue, to: JSONValue): Operation[] {
  const ops: Operation[] = [];
  walk([], from, to, ops);
  return ops;
}

/**
 * `path` plus one segment, as a type the ops that need it will accept.
 *
 * `remove` takes a NonEmptyArray, and TypeScript cannot see that spreading a
 * `string[]` and appending one element produces one - so it is built here in a
 * shape it can check, rather than asserted.
 */
function childPath(path: string[], key: string): [string, ...string[]] {
  const [first, ...rest] = path;
  return first === undefined ? [key] : [first, ...rest, key];
}

function isPlainObject(
  value: JSONValue,
): value is { [key: string]: JSONValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(
  path: string[],
  from: JSONValue,
  to: JSONValue,
  ops: Operation[],
): void {
  if (deepEqual(from, to)) {
    return;
  }

  if (Array.isArray(from) && Array.isArray(to)) {
    if (from.length !== to.length) {
      // A length change would need `add`/`remove`, which splice. One replace of
      // the whole array says the same thing and cannot be mis-ordered.
      ops.push({ op: "replace", path, value: to });
      return;
    }
    for (let index = 0; index < from.length; index++) {
      walk([...path, String(index)], from[index], to[index], ops);
    }
    return;
  }

  if (isPlainObject(from) && isPlainObject(to)) {
    for (const key of Object.keys(from)) {
      if (!(key in to)) {
        // Object keys are named, not positional, so removing one cannot shift
        // anything else - unlike an array index.
        ops.push({ op: "remove", path: childPath(path, key) });
      }
    }
    for (const [key, toValue] of Object.entries(to)) {
      const fromValue = from[key];
      if (!(key in from)) {
        ops.push({ op: "add", path: [...path, key], value: toValue });
        continue;
      }
      walk([...path, key], fromValue, toValue, ops);
    }
    return;
  }

  // Different kinds, or two primitives that differ. Note this also covers an
  // array becoming an object and vice versa, where descending would be
  // meaningless.
  ops.push({ op: "replace", path, value: to });
}
