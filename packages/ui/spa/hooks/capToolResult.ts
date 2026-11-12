/**
 * The content tools' answers, cut to what a model can be handed at once.
 *
 * Nothing bounded them: `get_all_schema` of a large project, `get_source` of
 * a big record or `validate_content` of a broken one went to the model
 * whole, however long, and an answer too long for the model ends the turn
 * rather than informing it. The code tools already cut theirs with a
 * `truncated` hint; this is the same for the content tools, in one place.
 *
 * What is cut is never cut silently, and never cut in a way that changes
 * what the rest means:
 *
 * - An object keeps the entries that fit and leaves out the rest by key, so
 *   every key that is there means what it meant.
 * - An array keeps a PREFIX: dropping an item from the middle would move
 *   every index after it, and a model writing a patch to index 5 would
 *   change what was index 6.
 * - A string, number or boolean is kept whole or left out. Half a string
 *   reads as content that ends there.
 * - What was left out is named (`omitted`, as path arrays like
 *   `create_patch`'s), and `truncated` says how to ask for less.
 */

/**
 * At most this many characters of JSON go back to the model from a content
 * tool. Chosen so a normal `get_all_schema` fits with room to spare: the
 * TanStack showcase (43 modules, every schema type) serializes to 62k
 * characters, `examples/next` (23 modules) to 33k. The same bound as
 * `read_file`'s.
 */
export const MAX_CONTENT_TOOL_RESULT_CHARS = 200_000;

/** Room kept for `truncated` and `omitted` themselves. */
const HINT_ROOM = 4_000;

/** At most this many omitted paths are named; the count says the rest. */
const MAX_NAMED_OMISSIONS = 50;

/** A container smaller than this is left out rather than cut open. */
const MIN_SPLIT_BUDGET = 500;

export type CapOptions = {
  /** How to ask for less, said in the hint: a module, a path, a query. */
  narrow: string;
  /**
   * Entries down to this depth are kept whole or left out, never cut open:
   * `1` keeps each top-level entry (a module's schema) whole. Default `0`:
   * anything can be cut open.
   */
  wholeDepth?: number;
  /** For tests. */
  maxChars?: number;
};

export type Capped = {
  value: unknown;
  /** Set when anything was left out: what, and how to ask for less. */
  truncated?: string;
  /** What was left out, as paths from the value's root. */
  omitted?: string[][];
};

/** `value`, or as much of it as fits, with what was left out. */
export function capToolResult(value: unknown, options: CapOptions): Capped {
  const max = options.maxChars ?? MAX_CONTENT_TOOL_RESULT_CHARS;
  const size = sizeOf(value);
  if (size <= max) return { value };
  const omitted: string[][] = [];
  const kept = fit(
    value,
    Math.max(max - HINT_ROOM, 0),
    [],
    options.wholeDepth ?? 0,
    omitted,
  );
  const named = omitted.slice(0, MAX_NAMED_OMISSIONS);
  return {
    value: kept === LEFT_OUT ? null : kept,
    truncated:
      `The answer is ${size} characters, more than the ${max} that are sent at once, so ${omitted.length} ${omitted.length === 1 ? "part was" : "parts were"} left out` +
      `${omitted.length > named.length ? ` (the first ${named.length} are named in omitted)` : " (named in omitted)"}. ` +
      `What is here is exactly as it is; nothing in it was shortened. ${options.narrow}`,
    omitted: named,
  };
}

/**
 * A tool's answer, capped: as it was when it fits; else an object with
 * `truncated` and `omitted` beside its own keys, or anything else under
 * `result` with them.
 */
export function cappedToolResult(value: unknown, options: CapOptions): unknown {
  const capped = capToolResult(value, options);
  if (capped.truncated === undefined) return capped.value;
  const hint = { truncated: capped.truncated, omitted: capped.omitted };
  return isPlainObject(capped.value)
    ? { ...capped.value, ...hint }
    : { result: capped.value, ...hint };
}

const LEFT_OUT = Symbol("left out");

function fit(
  value: unknown,
  budget: number,
  path: string[],
  wholeDepth: number,
  omitted: string[][],
): unknown {
  if (sizeOf(value) <= budget) return value;
  const splittable =
    (path.length === 0 || path.length > wholeDepth) &&
    budget >= MIN_SPLIT_BUDGET &&
    (Array.isArray(value) || isPlainObject(value));
  if (!splittable) {
    omitted.push(path);
    return LEFT_OUT;
  }
  if (Array.isArray(value)) {
    const kept: unknown[] = [];
    let used = 2;
    for (let index = 0; index < value.length; index++) {
      const item: unknown = value[index];
      const itemPath = [...path, String(index)];
      const size = sizeOf(item) + 1;
      if (used + size <= budget) {
        kept.push(item);
        used += size;
        continue;
      }
      // The first that does not fit whole is cut open if it can be, and
      // everything after it is left out: a prefix keeps every index true.
      const part = fit(item, budget - used - 1, itemPath, wholeDepth, omitted);
      if (part !== LEFT_OUT) kept.push(part);
      for (let rest = index + 1; rest < value.length; rest++) {
        omitted.push([...path, String(rest)]);
      }
      break;
    }
    return kept;
  }
  if (!isPlainObject(value)) {
    omitted.push(path);
    return LEFT_OUT;
  }
  // Whole entries first, in order; then what is left cuts open the ones
  // that did not fit, so one big entry does not crowd out every small one.
  const entries = Object.entries(value);
  const whole = new Set<string>();
  let used = 2;
  for (const [key, entry] of entries) {
    const size = sizeOf(key) + 1 + sizeOf(entry) + 1;
    if (used + size <= budget) {
      whole.add(key);
      used += size;
    }
  }
  const parts = new Map<string, unknown>();
  for (const [key, entry] of entries) {
    if (whole.has(key)) continue;
    const room = budget - used - sizeOf(key) - 2;
    const part = fit(entry, room, [...path, key], wholeDepth, omitted);
    if (part !== LEFT_OUT) {
      parts.set(key, part);
      used += sizeOf(key) + 2 + sizeOf(part);
    }
  }
  const kept: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    if (whole.has(key)) kept[key] = entry;
    else if (parts.has(key)) kept[key] = parts.get(key);
  }
  return kept;
}

function sizeOf(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
