import { Internal, VAL_EXTENSION, type PatchId } from "@valbuild/core";
import type { SerializedSchema } from "@valbuild/core";
import { result, type array } from "@valbuild/core/fp";
import {
  deepEqual,
  parseAndValidateArrayIndex,
  PatchError,
  type Operation,
  type Patch,
  type ReadonlyJSONValue,
} from "@valbuild/core/patch";
import {
  classifyJsonValuesOp,
  expandJsonValuesRootOp,
  isJsonValuesRootOp,
  rebaseContentOp,
  wholeEntryKey,
  type JsonValuesOpClass,
} from "./jsonValuesOps";

/*
 * THE engine: one function that turns a module's content and a patch into
 * the module's next content. See `docs/plans/one-content-model.md`, "One
 * engine".
 *
 * It owns the rules the server's two readers used to follow each in their own
 * way (`ValOps.getSources` for the module, and a replay of its own for a
 * `.jsonValues()` entry, kept test-only in `legacyEngine.ts` in
 * `@valbuild/server` for the conformance cases):
 *
 * - where a file's `patch_id` lands: the field's path plus `nestedFilePath`,
 *   after every other op of the patch;
 * - what an edit inside an entry does: applied to the entry's content when it
 *   is loaded, held (`waiting`) until it is when it is not;
 * - what a whole entry added does: a marker in the module, content in the
 *   entry;
 * - that a module's chain stops at its first failing patch, and that the
 *   entries stop with it.
 *
 * Copy-on-write along each op's path: nothing is mutated, so a subtree no op
 * touched keeps its identity (which makes "did this path change?" a `===`),
 * and a patch costs the depth of its path, not the module's size. Every
 * container it copies is counted ({@link engineWork}).
 */

/** What one `.jsonValues()` entry is at a point in a module's chain. */
export type EntryState =
  /** Its content, known. */
  | { kind: "content"; content: ReadonlyJSONValue }
  /**
   * The content of the BASE entry `from` (its own key, or the one it was
   * moved or copied from), with `ops` on top: an entry nobody has loaded,
   * whose edits are held until somebody does ({@link resolveEntry}).
   */
  | { kind: "waiting"; from: string; ops: HeldOps | null }
  /** Removed, or moved away. */
  | { kind: "deleted" }
  /** An op on it could not be applied. Sticky, as a module's failure is. */
  | { kind: "error"; patchId: PatchId; message: string };

/**
 * The ops held for an entry, newest first: a list that is extended without
 * copying, so a chain of N edits to an entry nobody loaded costs N, not N².
 */
export type HeldOps = {
  readonly op: Operation;
  readonly patchId: PatchId;
  readonly before: HeldOps | null;
};

/**
 * A module's content: its source, and what its `.jsonValues()` entries are.
 *
 * `entries` holds only the entries the chain has touched. An entry it has
 * not is the base's: `waiting` on its own key with nothing held, as long as
 * the source has its marker ({@link entryState}). So a module with no
 * entries, or a chain that never touches one, costs nothing here.
 */
export type ModuleContent = {
  readonly source: ReadonlyJSONValue;
  readonly entries: ReadonlyMap<string, EntryState>;
};

/** One patch of a module's chain. */
export type PatchRecord = { readonly patchId: PatchId; readonly patch: Patch };

export type PatchRecordResult =
  | { status: "applied"; module: ModuleContent }
  | { status: "failed"; patchId: PatchId; message: string };

const NO_ENTRIES: ReadonlyMap<string, EntryState> = new Map();

/** A module's content with nothing applied yet: its base. */
export function baseModuleContent(source: ReadonlyJSONValue): ModuleContent {
  return { source, entries: NO_ENTRIES };
}

// #region counted work

/**
 * What a copied container costs, per slot copied (an object's entry or an
 * array's element): one reference. Strings and numbers are shared, never
 * copied, so this is what a copy really moves -- and what the whole module
 * cost per patch before copy-on-write (`applyPatch(deepClone(module))`).
 */
const SLOT_BYTES = 8;

let applies = 0;
let clonedBytes = 0;

/**
 * The work the engine has done in this process: patches applied
 * (`engine:apply-patch`) and bytes copied (`engine:clone-bytes`, see
 * {@link SLOT_BYTES}). A test takes it before and after; never reset, so two
 * readers of it cannot disturb each other.
 */
export function engineWork(): { applyPatch: number; cloneBytes: number } {
  return { applyPatch: applies, cloneBytes: clonedBytes };
}

// #region the patch

/**
 * Applies one patch to a module's content. Nothing is mutated: the module
 * passed in is still what it was, and the one returned shares every subtree
 * the patch did not touch.
 *
 * `failed` means the patch does not apply, and then none of it does: half a
 * patch is half an edit. The caller stops the module's chain there.
 *
 * `schema` is the module's serialized schema: it says which ops reach into a
 * `.jsonValues()` entry. Without one, every op is an op on the source.
 */
export function applyPatchRecord(
  module: ModuleContent,
  record: PatchRecord,
  schema: SerializedSchema | undefined,
): PatchRecordResult {
  applies++;
  const { patchId } = record;
  const fail = (message: string): PatchRecordResult => ({
    status: "failed",
    patchId,
    message,
  });
  let source = module.source;
  let entries: Map<string, EntryState> | null = null;
  const stateOf = (key: string): EntryState | undefined =>
    (entries ?? module.entries).get(key) ?? implicitState(source, key);
  const setEntry = (key: string, state: EntryState) => {
    if (entries === null) {
      clonedBytes += SLOT_BYTES * module.entries.size;
      entries = new Map(module.entries);
    }
    entries.set(key, state);
  };
  /** Sets it, unless the entry already failed: an entry's error is sticky. */
  const settle = (key: string, state: EntryState) => {
    if (stateOf(key)?.kind !== "error") setEntry(key, state);
  };
  /**
   * The record's keys as they stand while this patch is walked, for a write
   * of the whole record to expand against. Only the key set: the source holds
   * markers, and an entry's content may not be loaded. Seeded from the source
   * BEFORE this patch and kept current by the whole-entry ops below.
   */
  let keys: Map<string, undefined> | null = null;
  const currentKeys = (): Map<string, undefined> => {
    if (keys === null) {
      keys = new Map();
      if (isObjectNode(module.source)) {
        for (const key of Object.keys(module.source)) keys.set(key, undefined);
      }
    }
    return keys;
  };
  /** Where a file's `patch_id` lands in the source; last write wins its place. */
  const fileMarks = new Map<string, string[]>();
  /** And in an entry's content. */
  const entryFileMarks: { key: string; path: string[] }[] = [];

  for (const rawOp of record.patch) {
    /*
     * A write of the WHOLE record fans out into per-entry ops first, through
     * the expansion the commit flow uses too (`expandJsonValuesRootOp`).
     * Left as it is, it would put content where the source holds markers.
     */
    let ops: readonly Operation[] = [rawOp];
    if (schema !== undefined && isJsonValuesRootOp(schema, rawOp)) {
      const expanded = expandJsonValuesRootOp(rawOp, currentKeys());
      if (result.isErr(expanded)) return fail(expanded.error.message);
      ops = expanded.value;
    }
    for (const op of ops) {
      const cls: JsonValuesOpClass =
        schema === undefined
          ? { kind: "normal" }
          : classifyJsonValuesOp(schema, op.path);

      if (op.op === "file") {
        /*
         * A file op carries bytes, not content. What the content needs is
         * the `patch_id` saying those bytes are not published yet, so the
         * file is served from the patch rather than from a `/public` path
         * that holds nothing. Keyed by where it LANDS -- the field's path
         * plus `nestedFilePath` -- because a video's poster and captions are
         * file ops on the video's own path. A delete has no bytes to point at.
         */
        if (op.value === null) continue;
        const nested = op.nestedFilePath ?? [];
        if (cls.kind === "entry" && cls.subPath.length > 0) {
          if (cls.recordPath.length === 0) {
            entryFileMarks.push({
              key: cls.entryKey,
              path: cls.subPath.concat(nested, "patch_id"),
            });
          }
          continue;
        }
        const at = op.path.concat(nested, "patch_id");
        fileMarks.set(JSON.stringify(at), at);
        if (cls.kind === "entry" && cls.recordPath.length === 0) {
          // The entry IS the media: its content gets the mark too.
          entryFileMarks.push({
            key: cls.entryKey,
            path: nested.concat("patch_id"),
          });
        }
        continue;
      }

      if (cls.kind === "normal") {
        const applied = applyOp(source, op);
        if (result.isErr(applied)) return fail(applied.error.message);
        source = applied.value;
        if (op.op === "move") {
          const fromKey = wholeEntryKey(schema, op.from);
          if (fromKey !== undefined) settle(fromKey, { kind: "deleted" });
        }
        if (
          op.path.length === 0 &&
          schema?.type === "record" &&
          schema.jsonValues === true
        ) {
          // The record itself was replaced (by something that is not a
          // record): every entry went with it.
          clonedBytes += SLOT_BYTES * (entries ?? module.entries).size;
          entries = new Map();
        }
        continue;
      }

      if (cls.recordPath.length > 0) {
        return fail(
          `Nested .jsonValues() records are not supported: '${cls.recordPath.join(
            ".",
          )}'. Use .jsonValues() only on a module's root record/router.`,
        );
      }
      const key = cls.entryKey;

      if (cls.subPath.length > 0) {
        // An edit INSIDE an entry: its content, never the source's marker.
        if (op.op === "move" || op.op === "copy") {
          const fromCls: JsonValuesOpClass =
            schema === undefined
              ? { kind: "normal" }
              : classifyJsonValuesOp(schema, op.from);
          if (fromCls.kind !== "entry" || fromCls.entryKey !== key) {
            return fail(
              `Cannot '${op.op}' between different jsonValues entries`,
            );
          }
        }
        const rebased = rebaseContentOp(op, cls.recordPath.length + 1);
        if (result.isErr(rebased)) return fail(rebased.error.message);
        const state = stateOf(key);
        if (state === undefined || state.kind === "deleted") {
          setEntry(key, {
            kind: "error",
            patchId,
            message: `Cannot edit jsonValues entry '${key}': it does not exist`,
          });
        } else if (state.kind === "waiting") {
          setEntry(key, {
            kind: "waiting",
            from: state.from,
            ops: { op: rebased.value, patchId, before: state.ops },
          });
        } else if (state.kind === "content") {
          const applied = applyOp(state.content, rebased.value);
          setEntry(
            key,
            result.isErr(applied)
              ? { kind: "error", patchId, message: applied.error.message }
              : { kind: "content", content: applied.value },
          );
        }
        continue;
      }

      // A WHOLE entry: a marker in the source, content in the entry.
      const marker = { [VAL_EXTENSION]: "json", patch_id: patchId };
      if (op.op === "add" || op.op === "replace") {
        const written =
          op.op === "add"
            ? addAt(source, op.path, marker)
            : replaceAt(source, op.path, marker);
        if (result.isErr(written)) return fail(written.error.message);
        source = written.value;
        currentKeys().set(key, undefined);
        settle(key, { kind: "content", content: op.value });
      } else if (op.op === "remove") {
        const removed = removeAt(source, op.path);
        if (result.isErr(removed)) return fail(removed.error.message);
        source = removed.value.doc;
        currentKeys().delete(key);
        settle(key, { kind: "deleted" });
      } else if (op.op === "move" || op.op === "copy") {
        const fromCls: JsonValuesOpClass =
          schema === undefined
            ? { kind: "normal" }
            : classifyJsonValuesOp(schema, op.from);
        if (
          fromCls.kind !== "entry" ||
          fromCls.subPath.length !== 0 ||
          fromCls.recordPath.length !== 0
        ) {
          return fail(
            `Cannot '${op.op}' a jsonValues entry across records or from a non-entry path (from '${op.from.join(
              ".",
            )}' to '${op.path.join(".")}')`,
          );
        }
        const fromKey = fromCls.entryKey;
        // Read before anything moves: the destination is the source entry
        // as it stood at this op.
        const fromState = stateOf(fromKey);
        const added = addAt(source, op.path, marker);
        if (result.isErr(added)) return fail(added.error.message);
        source = added.value;
        currentKeys().set(key, undefined);
        if (op.op === "move") {
          const removed = removeAt(source, op.from);
          if (result.isErr(removed)) return fail(removed.error.message);
          source = removed.value.doc;
          currentKeys().delete(fromKey);
        }
        settle(
          key,
          fromState === undefined || fromState.kind === "deleted"
            ? {
                kind: "error",
                patchId,
                message: `Cannot resolve '${op.op}' of jsonValues entry '${key}' from its own content`,
              }
            : fromState,
        );
        if (op.op === "move" && fromKey !== key) {
          settle(fromKey, { kind: "deleted" });
        }
      } else {
        // `test` of a whole entry: the commit refuses it (`ValOps.prepare`),
        // so the read does too, rather than showing a patch publishing fails.
        return fail(
          `Unsupported op '${op.op}' on jsonValues entry '${key}' (supported: add, remove, replace, move, copy)`,
        );
      }
    }
  }

  for (const at of fileMarks.values()) {
    const marked = addAt(source, at, patchId);
    if (result.isErr(marked)) return fail(marked.error.message);
    source = marked.value;
  }
  for (const { key, path } of entryFileMarks) {
    const state = stateOf(key);
    const op: Operation = { op: "add", path, value: patchId };
    if (state?.kind === "content") {
      const applied = applyOp(state.content, op);
      setEntry(
        key,
        result.isErr(applied)
          ? { kind: "error", patchId, message: applied.error.message }
          : { kind: "content", content: applied.value },
      );
    } else if (state?.kind === "waiting") {
      setEntry(key, {
        kind: "waiting",
        from: state.from,
        ops: { op, patchId, before: state.ops },
      });
    }
  }
  return {
    status: "applied",
    module: { source, entries: entries ?? module.entries },
  };
}

/**
 * A module's chain: every patch in order, stopping at the first that does
 * not apply. `applied` is how many did, so the chain the content is AT is
 * the first `applied` ids -- what its version names.
 */
export function applyChain(
  module: ModuleContent,
  records: readonly PatchRecord[],
  schema: SerializedSchema | undefined,
): {
  module: ModuleContent;
  applied: number;
  failed: { patchId: PatchId; message: string } | null;
} {
  let current = module;
  for (const [index, record] of records.entries()) {
    const res = applyPatchRecord(current, record, schema);
    if (res.status === "failed") {
      return {
        module: current,
        applied: index,
        failed: { patchId: res.patchId, message: res.message },
      };
    }
    current = res.module;
  }
  return { module: current, applied: records.length, failed: null };
}

// #region entries

/**
 * What an entry is in this module: what the chain made it, or -- for one the
 * chain never touched -- the base's, if the source has its marker.
 */
export function entryState(
  module: ModuleContent,
  key: string,
): EntryState | undefined {
  return module.entries.get(key) ?? implicitState(module.source, key);
}

function implicitState(
  source: ReadonlyJSONValue,
  key: string,
): EntryState | undefined {
  return isObjectNode(source) &&
    Object.prototype.hasOwnProperty.call(source, key) &&
    Internal.isJson(source[key])
    ? { kind: "waiting", from: key, ops: null }
    : undefined;
}

/** An entry's content, read. */
export type EntryRead =
  | { kind: "content"; content: ReadonlyJSONValue }
  | { kind: "missing" }
  | { kind: "error"; message: string; patchId?: PatchId };

/**
 * An entry's content: what {@link entryState} says, with what it was waiting
 * for applied. `baseContentOf` is the BASE content of an entry by key (its
 * `*.val.json`, or what a save left there), `undefined` for one the base does
 * not have.
 */
export function resolveEntry(
  key: string,
  state: EntryState | undefined,
  baseContentOf: (key: string) => ReadonlyJSONValue | undefined,
): EntryRead {
  if (state === undefined || state.kind === "deleted") {
    return { kind: "missing" };
  }
  if (state.kind === "error") {
    return { kind: "error", message: state.message, patchId: state.patchId };
  }
  if (state.kind === "content") {
    return { kind: "content", content: state.content };
  }
  const held: HeldOps[] = [];
  for (let at = state.ops; at !== null; at = at.before) held.push(at);
  let content = baseContentOf(state.from);
  if (content === undefined) {
    const first = held[held.length - 1];
    return first === undefined
      ? { kind: "missing" }
      : {
          kind: "error",
          message: `Cannot edit jsonValues entry '${key}': it does not exist`,
          patchId: first.patchId,
        };
  }
  for (let i = held.length - 1; i >= 0; i--) {
    const { op, patchId } = held[i];
    const applied = applyOp(content, op);
    if (result.isErr(applied)) {
      return { kind: "error", message: applied.error.message, patchId };
    }
    content = applied.value;
  }
  return { kind: "content", content };
}

// #region copy-on-write JSON ops

/*
 * RFC 6902 as `JSONOps` (in `@valbuild/core/patch`) applies it -- the same
 * results and the same error messages, which the conformance cases hold --
 * but without mutating anything: a container on an op's path is copied, and
 * everything else is shared.
 */

type Doc = ReadonlyJSONValue;
type DocObject = { readonly [key: string]: Doc };
type DocArray = readonly Doc[];
type Res<T> = result.Result<T, PatchError>;

function isArrayNode(node: Doc): node is DocArray {
  return Array.isArray(node);
}

function isObjectNode(node: Doc): node is DocObject {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

function hasOwn(node: DocObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(node, key);
}

function patchError<T>(message: string): Res<T> {
  return result.err(new PatchError(message));
}

function copyArray(node: DocArray): Doc[] {
  clonedBytes += SLOT_BYTES * node.length;
  return node.slice();
}

function copyObject(node: DocObject): { [key: string]: Doc } {
  const copy: { [key: string]: Doc } = {};
  let slots = 0;
  for (const key of Object.keys(node)) {
    setOwn(copy, key, node[key]);
    slots++;
  }
  clonedBytes += SLOT_BYTES * slots;
  return copy;
}

/** An own property, even for `__proto__`, which `=` would not create. */
function setOwn(target: { [key: string]: Doc }, key: string, value: Doc) {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

function arrayIndex(key: string, node: DocArray, inclusive: boolean) {
  if (inclusive && key === "-") return result.ok(node.length);
  const index = parseAndValidateArrayIndex(key);
  if (result.isErr(index)) return index;
  return (inclusive ? index.value <= node.length : index.value < node.length)
    ? index
    : patchError<number>("Array index out of bounds");
}

function childOf(node: Doc, key: string): Res<Doc | undefined> {
  if (isArrayNode(node)) {
    const index = parseAndValidateArrayIndex(key);
    if (result.isErr(index)) return index;
    return index.value >= node.length
      ? patchError("Array index out of bounds")
      : result.ok(node[index.value]);
  }
  if (isObjectNode(node)) {
    return result.ok(hasOwn(node, key) ? node[key] : undefined);
  }
  return patchError("Cannot access non-object/array");
}

/** `node` with `key` set to `value`: the one copy a step on a path costs. */
function withChild(node: Doc, key: string, value: Doc): Doc {
  if (isArrayNode(node)) {
    const copy = copyArray(node);
    copy[Number(key)] = value;
    return copy;
  }
  if (isObjectNode(node)) {
    const copy = copyObject(node);
    setOwn(copy, key, value);
    return copy;
  }
  return node;
}

/**
 * Walks `path` to the parent of its last segment, lets `leaf` change that
 * parent, and copies every container on the way back up. Errors as
 * `JSONOps`'s pointer walk: the first missing step is reported.
 */
function updateAt<T>(
  node: Doc,
  path: array.NonEmptyArray<string>,
  index: number,
  leaf: (parent: Doc, key: string) => Res<{ node: Doc; out: T }>,
): Res<{ node: Doc; out: T }> {
  const key = path[index];
  if (index === path.length - 1) return leaf(node, key);
  const child = childOf(node, key);
  if (result.isErr(child)) return child;
  if (child.value === undefined) {
    return patchError("Path refers to non-existing object/array");
  }
  const updated = updateAt(child.value, path, index + 1, leaf);
  if (result.isErr(updated)) return updated;
  return result.ok({
    node:
      updated.value.node === child.value
        ? node
        : withChild(node, key, updated.value.node),
    out: updated.value.out,
  });
}

function isNonEmpty(path: string[]): path is array.NonEmptyArray<string> {
  return path.length > 0;
}

function getAt(doc: Doc, path: readonly string[]): Res<Doc> {
  let node = doc;
  for (const key of path) {
    const child = childOf(node, key);
    if (result.isErr(child)) return child;
    if (child.value === undefined) {
      return patchError("Path refers to non-existing object/array");
    }
    node = child.value;
  }
  return result.ok(node);
}

function addAt(doc: Doc, path: string[], value: Doc): Res<Doc> {
  if (!isNonEmpty(path)) return result.ok(value);
  const res = updateAt(doc, path, 0, (parent, key) => {
    if (isArrayNode(parent)) {
      const index = arrayIndex(key, parent, true);
      if (result.isErr(index)) return index;
      const copy = copyArray(parent);
      copy.splice(index.value, 0, value);
      return result.ok({ node: copy, out: null });
    }
    if (isObjectNode(parent)) {
      const copy = copyObject(parent);
      setOwn(copy, key, value);
      return result.ok({ node: copy, out: null });
    }
    return patchError("Cannot add to non-object/array");
  });
  return result.isErr(res) ? res : result.ok(res.value.node);
}

function replaceAt(doc: Doc, path: string[], value: Doc): Res<Doc> {
  if (!isNonEmpty(path)) return result.ok(value);
  const res = updateAt(doc, path, 0, (parent, key) => {
    if (isArrayNode(parent)) {
      const index = arrayIndex(key, parent, false);
      if (result.isErr(index)) return index;
      const copy = copyArray(parent);
      copy[index.value] = value;
      return result.ok({ node: copy, out: null });
    }
    if (isObjectNode(parent)) {
      if (!hasOwn(parent, key)) {
        return patchError("Cannot replace object element which does not exist");
      }
      const copy = copyObject(parent);
      setOwn(copy, key, value);
      return result.ok({ node: copy, out: null });
    }
    return patchError("Cannot replace in non-object/array");
  });
  return result.isErr(res) ? res : result.ok(res.value.node);
}

function removeAt(doc: Doc, path: string[]): Res<{ doc: Doc; removed: Doc }> {
  if (!isNonEmpty(path)) {
    return patchError("Cannot remove from non-object/array");
  }
  const res = updateAt<Doc>(doc, path, 0, (parent, key) => {
    if (isArrayNode(parent)) {
      const index = arrayIndex(key, parent, false);
      if (result.isErr(index)) return index;
      const copy = copyArray(parent);
      const [removed] = copy.splice(index.value, 1);
      return result.ok({ node: copy, out: removed });
    }
    if (isObjectNode(parent) && hasOwn(parent, key)) {
      const copy = copyObject(parent);
      const removed = parent[key];
      delete copy[key];
      return result.ok({ node: copy, out: removed });
    }
    return patchError("Cannot remove from non-object/array");
  });
  return result.isErr(res)
    ? res
    : result.ok({ doc: res.value.node, removed: res.value.out });
}

/** One op on a document. `file` is not an op on content: the caller marks. */
function applyOp(doc: Doc, op: Operation): Res<Doc> {
  switch (op.op) {
    case "add":
      return addAt(doc, op.path, op.value);
    case "replace":
      return replaceAt(doc, op.path, op.value);
    case "remove": {
      const removed = removeAt(doc, op.path);
      return result.isErr(removed) ? removed : result.ok(removed.value.doc);
    }
    case "move": {
      const removed = removeAt(doc, op.from);
      if (result.isErr(removed)) return removed;
      return addAt(removed.value.doc, op.path, removed.value.removed);
    }
    case "copy": {
      // Shared, not cloned: nothing here mutates, so two places can hold one
      // value.
      const value = getAt(doc, op.from);
      if (result.isErr(value)) return value;
      return addAt(doc, op.path, value.value);
    }
    case "test": {
      // As `applyPatch` in `@valbuild/core/patch`, which the commit applies
      // `.val.ts` text through: a path that does not exist, or a value there
      // that is not deeply equal, fails the patch (RFC 6902, 4.6). The two
      // have to agree, or a draft shows a patch Publish refuses.
      const value = getAt(doc, op.path);
      if (result.isErr(value)) return value;
      if (!deepEqual(op.value, value.value)) return patchError("Test failed");
      return result.ok(doc);
    }
    case "file":
      return patchError("Cannot apply a file patch here");
  }
}
