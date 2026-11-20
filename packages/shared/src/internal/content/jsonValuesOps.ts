import { Internal, VAL_EXTENSION, type SerializedSchema } from "@valbuild/core";
import { array, result } from "@valbuild/core/fp";
import {
  deepEqual,
  PatchError,
  type JSONValue,
  type Operation,
} from "@valbuild/core/patch";

/*
 * How a patch op relates to a `.jsonValues()` record: which ops reach into an
 * entry, what a write of the whole record says about each entry, and how an
 * op inside an entry is rebased onto the entry's own file.
 *
 * Here, in shared, because the engine (`applyChain.ts`) is built on them and
 * runs wherever content is patched; the commit flow (`ValOps.prepare`), the
 * CLI's fixes and the language server use the same functions, through
 * `@valbuild/server`, which re-exports them. One rule, one implementation:
 * a draft that shows one thing while publishing writes another is the failure
 * nobody sees until it is published.
 */

/**
 * Classification of a single patch op against a module's serialized schema,
 * used by the commit flow to route ops for `.jsonValues()` records:
 *
 * - `normal`: the op does not descend into a `.jsonValues()` entry; apply it to
 *   the `.val.ts` as usual.
 * - `entry`: the op targets a `.jsonValues()` entry. `recordPath` is the path to
 *   the record within the module source (empty for a root record/router),
 *   `entryKey` is the entry key, and `subPath` is the remaining path inside the
 *   entry (empty when the op targets the entry value itself, e.g. add/remove of
 *   the whole entry).
 */
export type JsonValuesOpClass =
  | { kind: "normal" }
  | {
      kind: "entry";
      recordPath: string[];
      entryKey: string;
      subPath: string[];
    };

/**
 * Walks the serialized schema following the op path. When a `.jsonValues()`
 * record is encountered, the next path segment is the entry key and everything
 * after it lives inside the entry's `*.val.json` (so it does not touch the
 * `.val.ts`). Returns `{ kind: "normal" }` when the op never enters a
 * `.jsonValues()` record.
 */
export function classifyJsonValuesOp(
  schema: SerializedSchema,
  opPath: string[],
): JsonValuesOpClass {
  let current: SerializedSchema | undefined = schema;
  const recordPath: string[] = [];
  for (let i = 0; i < opPath.length; i++) {
    if (!current) {
      return { kind: "normal" };
    }
    if (current.type === "record" && current.jsonValues) {
      return {
        kind: "entry",
        recordPath: recordPath.slice(),
        entryKey: opPath[i],
        subPath: opPath.slice(i + 1),
      };
    }
    const seg = opPath[i];
    current = descend(current, seg);
    recordPath.push(seg);
  }
  return { kind: "normal" };
}

function descend(
  schema: SerializedSchema,
  key: string,
): SerializedSchema | undefined {
  switch (schema.type) {
    case "object":
      return schema.items[key];
    case "record":
      return schema.item;
    case "array":
      return schema.item;
    default:
      // Unions / primitives / leaf schemas: we cannot (or need not) descend
      // further to find a jsonValues record. Anything below is a normal
      // `.val.ts` edit.
      return undefined;
  }
}

/**
 * Is this op a write of the WHOLE record at the root of a `.jsonValues()`
 * module?
 *
 * The one op {@link classifyJsonValuesOp} cannot classify: it finds the entry
 * key by walking the op path, and the root path has no segments to walk, so a
 * root write reads as `normal` and gets applied to the `.val.ts` - writing
 * markers over the `c.json(() => import(...))` calls that make the entries load
 * at all. {@link expandJsonValuesRootOp} turns it into ops that DO name a key,
 * which everything downstream already handles.
 *
 * `add` counts as well as `replace`: at the root both mean "the document is now
 * this" (see `JSONOps`), so both have to be expanded or the unexpanded one is
 * the same bug again.
 *
 * The value has to BE a record, and that is part of the question rather than a
 * check inside the expansion: a `.jsonValues()` record can be nullable, and
 * `null` at the root means the module no longer has a record at all - there are
 * no entries to write, and it is an ordinary `.val.ts` write, exactly as it was
 * before any of this existed. Same for any other non-record value: not a
 * whole-record write, so not this conversion's to route.
 */
export function isJsonValuesRootOp(
  schema: SerializedSchema,
  op: Operation,
): boolean {
  return (
    (op.op === "replace" || op.op === "add") &&
    op.path.length === 0 &&
    isJsonValuesRecord(op.value) &&
    schema.type === "record" &&
    schema.jsonValues === true
  );
}

function isJsonValuesRecord(
  value: JSONValue,
): value is { [key: string]: JSONValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One entry as it stands right now, for {@link expandJsonValuesRootOp} to
 * expand against.
 *
 * The key set decides add-vs-replace-vs-remove. The content, where the caller
 * has it, decides whether an op is emitted at all: an entry whose content is
 * already what the root write says is left alone rather than rewritten, so
 * putting a module back does not touch every `*.val.json` it did not change.
 * `undefined` means "this entry exists, content unknown" - which is what the
 * Studio's draft source has, because the source holds markers - and yields a
 * `replace`, the safe answer.
 */
export type CurrentJsonEntries = ReadonlyMap<string, JSONValue | undefined>;

/**
 * Fans a whole-record write at a `.jsonValues()` module's root out into ops
 * that each name an entry key.
 *
 * This is THE conversion, and it has exactly one implementation on purpose: the
 * commit flow (`ValOps.prepare`) and the engine that builds draft content
 * (`applyPatchRecord`) both expand through here, so a draft
 * cannot show something other than what publishing writes. A second
 * implementation of the same rule would differ silently, which is the whole
 * failure mode this exists to prevent.
 *
 * The value must be the entries' CONTENT. A module's Source is markers, not
 * content, so a Source handed over here is refused rather than written: that is
 * the shape of the original bug (a revert replaying the archived Source), and
 * it is not recoverable afterwards - the markers replace the entries' content
 * on disk.
 */
export function expandJsonValuesRootOp(
  op: Operation,
  currentEntries: CurrentJsonEntries,
): result.Result<Operation[], PatchError> {
  const valueRes = jsonValuesRootValue(op);
  if (result.isErr(valueRes)) {
    return valueRes;
  }
  const value = valueRes.value;
  const expanded: Operation[] = [];
  for (const entryKey of Object.keys(value)) {
    const write = writeForEntry(value, entryKey, currentEntries);
    if (write !== null) {
      expanded.push(write);
    }
  }
  for (const entryKey of currentEntries.keys()) {
    if (!Object.prototype.hasOwnProperty.call(value, entryKey)) {
      expanded.push({ op: "remove", path: [entryKey] });
    }
  }
  return result.ok(expanded);
}

/**
 * What a whole-record write says about ONE entry: the same rule
 * {@link expandJsonValuesRootOp} applies to all of them.
 *
 * For a reader that is about one entry. Expanding the whole record to find the
 * one op that names its key costs an op per entry per entry read - the record
 * squared, on exactly the large records this feature is for. The rule itself is
 * `writeForEntry`, shared with the expansion above, so the two cannot come to
 * disagree; only the loop around it differs.
 *
 * `null` means the write says nothing about this entry: it holds that content
 * already, or the record does not name it and it does not exist.
 */
export function expandJsonValuesRootOpForKey(
  op: Operation,
  entryKey: string,
  currentEntries: CurrentJsonEntries,
): result.Result<Operation | null, PatchError> {
  const valueRes = jsonValuesRootValue(op);
  if (result.isErr(valueRes)) {
    return valueRes;
  }
  const value = valueRes.value;
  if (Object.prototype.hasOwnProperty.call(value, entryKey)) {
    return result.ok(writeForEntry(value, entryKey, currentEntries));
  }
  if (currentEntries.has(entryKey)) {
    return result.ok({ op: "remove", path: [entryKey] });
  }
  return result.ok(null);
}

/**
 * The record a whole-record write carries, once it is known to be one.
 *
 * Every entry's value is checked here rather than where each one is written:
 * a marker anywhere in the record means the writer handed over a module's
 * Source, and the answer to that is to refuse the write, not to write the rest
 * of it. Both entry points ask, so an entry read reports it too rather than
 * showing a draft of a patch that publishing will refuse.
 */
function jsonValuesRootValue(
  op: Operation,
): result.Result<{ [key: string]: JSONValue }, PatchError> {
  if (op.op !== "replace" && op.op !== "add") {
    return result.err(
      new PatchError(
        `Cannot '${op.op}' the root of a .jsonValues() record: only add and replace write the whole record`,
      ),
    );
  }
  const value = op.value;
  if (!isJsonValuesRecord(value)) {
    return result.err(
      new PatchError(
        "Cannot write the root of a .jsonValues() record with a non-record value: it must be an object of entry key to entry content",
      ),
    );
  }
  for (const entryKey of Object.keys(value)) {
    /*
     * A marker is what a module's Source holds WHERE THE CONTENT IS NOT: it
     * says the content is in the entry's own file. Handed back as an entry's
     * value - which is what replaying an archived Source does - it would
     * replace that content with the note saying where it used to be, and
     * nothing downstream could tell the difference.
     */
    if (Internal.isJson(value[entryKey])) {
      return result.err(
        new PatchError(
          `Cannot write the .jsonValues() entry '${entryKey}' from a '${VAL_EXTENSION}: "json"' marker: a marker says the content is in the entry's own file, so write the entry's CONTENT here, not the module's Source`,
        ),
      );
    }
  }
  return result.ok(value);
}

/** THE rule, for one entry the record names. `null` = nothing to write. */
function writeForEntry(
  value: { [key: string]: JSONValue },
  entryKey: string,
  currentEntries: CurrentJsonEntries,
): Operation | null {
  const content = value[entryKey];
  if (!currentEntries.has(entryKey)) {
    return { op: "add", path: [entryKey], value: content };
  }
  const current = currentEntries.get(entryKey);
  if (current !== undefined && deepEqual(current, content)) {
    // Unchanged: emitting a replace here would rewrite the entry's file with
    // the bytes it already holds, so putting a module back would show up as a
    // change to every entry in it.
    return null;
  }
  return { op: "replace", path: [entryKey], value: content };
}

/**
 * Rebases a patch op that targets a `.jsonValues()` entry's content so its paths
 * are relative to the entry's `*.val.json` root (drops the record + entry-key
 * prefix). Used to replay the op against the backing JSON file.
 */
export function rebaseContentOp(
  op: Operation,
  prefixLen: number,
): result.Result<Operation, PatchError> {
  const path = op.path.slice(prefixLen);
  switch (op.op) {
    case "add":
    case "replace":
    case "test":
      return result.ok({ ...op, path });
    case "remove": {
      if (!array.isNonEmpty(path)) {
        return result.err(
          new PatchError("Cannot remove the root of a jsonValues entry"),
        );
      }
      return result.ok({ ...op, path });
    }
    case "move": {
      const from = op.from.slice(prefixLen);
      if (!array.isNonEmpty(from)) {
        return result.err(
          new PatchError("Cannot move from the root of a jsonValues entry"),
        );
      }
      return result.ok({ ...op, path, from });
    }
    case "copy":
      return result.ok({ ...op, path, from: op.from.slice(prefixLen) });
    case "file":
      // A file op carries bytes, not content. The binary goes through the
      // normal upload pipeline; what lands in the entry is the `patch_id` that
      // marks the bytes as not yet committed, which the caller writes.
      return result.err(
        new PatchError("A file op is not a content op: rebase it via its path"),
      );
  }
}

/**
 * The entry a path names when it names a WHOLE entry of the root
 * `.jsonValues()` record, and `undefined` for anything else.
 */
export function wholeEntryKey(
  serializedSchema: SerializedSchema | undefined,
  path: string[],
): string | undefined {
  if (!serializedSchema) {
    return undefined;
  }
  const cls = classifyJsonValuesOp(serializedSchema, path);
  return cls.kind === "entry" &&
    cls.recordPath.length === 0 &&
    cls.subPath.length === 0
    ? cls.entryKey
    : undefined;
}
