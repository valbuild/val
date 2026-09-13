import * as path from "path";
import {
  Internal,
  VAL_EXTENSION,
  type PatchId,
  type SerializedSchema,
} from "@valbuild/core";
import type { PatchSourceError } from "../ValOps";
import { array, result } from "@valbuild/core/fp";
import {
  applyPatch,
  deepClone,
  deepEqual,
  JSONOps,
  JSONValue,
  Operation,
  Patch,
  PatchError,
} from "@valbuild/core/patch";

const jsonOps = new JSONOps();

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
 */
export function isJsonValuesRootOp(
  schema: SerializedSchema,
  op: Operation,
): boolean {
  return (
    (op.op === "replace" || op.op === "add") &&
    op.path.length === 0 &&
    schema.type === "record" &&
    schema.jsonValues === true
  );
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
 * commit flow (`ValOps.prepare`) and the read side that builds draft content
 * ({@link applyJsonValuesEntryPatches}) both expand through here, so a draft
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
  if (op.op !== "replace" && op.op !== "add") {
    return result.err(
      new PatchError(
        `Cannot '${op.op}' the root of a .jsonValues() record: only add and replace write the whole record`,
      ),
    );
  }
  const value = op.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return result.err(
      new PatchError(
        "Cannot write the root of a .jsonValues() record with a non-record value: it must be an object of entry key to entry content",
      ),
    );
  }
  const expanded: Operation[] = [];
  for (const [entryKey, content] of Object.entries(value)) {
    /*
     * A marker is what a module's Source holds WHERE THE CONTENT IS NOT: it
     * says the content is in the entry's own file. Handed back as an entry's
     * value - which is what replaying an archived Source does - it would
     * replace that content with the note saying where it used to be, and
     * nothing downstream could tell the difference.
     */
    if (Internal.isJson(content)) {
      return result.err(
        new PatchError(
          `Cannot write the .jsonValues() entry '${entryKey}' from a '${VAL_EXTENSION}: "json"' marker: a marker says the content is in the entry's own file, so write the entry's CONTENT here, not the module's Source`,
        ),
      );
    }
    if (!currentEntries.has(entryKey)) {
      expanded.push({ op: "add", path: [entryKey], value: content });
      continue;
    }
    const current = currentEntries.get(entryKey);
    if (current !== undefined && deepEqual(current, content)) {
      // Unchanged: emitting a replace here would rewrite the entry's file with
      // the bytes it already holds, so putting a module back would show up as a
      // change to every entry in it.
      continue;
    }
    expanded.push({ op: "replace", path: [entryKey], value: content });
  }
  for (const entryKey of currentEntries.keys()) {
    if (!Object.prototype.hasOwnProperty.call(value, entryKey)) {
      expanded.push({ op: "remove", path: [entryKey] });
    }
  }
  return result.ok(expanded);
}

/**
 * Finds every `.jsonValues()` record in a module's schema that is NOT the
 * module's root, returning the path to each within the module source.
 *
 * `.jsonValues()` is only supported on a module's ROOT record/router: the
 * `/json` endpoint keys entries by a single string, the Studio substitutes
 * loaded content at the top level of the module source, and
 * `validateJsonValuesEntries` only visits a root record. A nested one would
 * silently skip content validation and hang the Studio on a 404, so we reject
 * it up front instead (see {@link ValOps.initSources}).
 */
export function findNestedJsonValuesRecords(
  schema: SerializedSchema,
  path: string[] = [],
): string[][] {
  const found: string[][] = [];
  const rec = (current: SerializedSchema, currentPath: string[]) => {
    if (
      current.type === "record" &&
      current.jsonValues &&
      currentPath.length > 0
    ) {
      found.push(currentPath);
      // Do not descend: everything below lives in the entry's `*.val.json`.
      return;
    }
    switch (current.type) {
      case "object":
        for (const key of Object.keys(current.items)) {
          rec(current.items[key], currentPath.concat(key));
        }
        return;
      case "record":
        rec(current.item, currentPath.concat("*"));
        return;
      case "array":
        rec(current.item, currentPath.concat("*"));
        return;
      case "discriminated-union":
        for (let i = 0; i < current.items.length; i++) {
          rec(current.items[i], currentPath.concat(`union[${i}]`));
        }
        return;
      default:
        return;
    }
  };
  rec(schema, path);
  return found;
}

/**
 * The `.val.ts` suffix a module file path ends with. Stripping it yields the
 * folder that a new entry's `*.val.json` files are nested under.
 */
const VAL_TS_SUFFIX = ".val.ts";

/**
 * Computes the `*.val.json` file path (relative to rootDir) and the `import(...)`
 * path (relative to the module's directory) for a NEW `.jsonValues()` entry,
 * following the locked filename convention: the file mirrors the entry key under
 * a folder named after the `.val.ts` (its `.val.ts` suffix becomes the folder).
 *
 * For module `/app/support/[slug]/page.val.ts` and key `/support/faq`:
 * - jsonPath:   `/app/support/[slug]/page/support/faq.val.json`
 * - importPath: `./page/support/faq.val.json`
 */
export function getNewJsonEntryPaths(
  moduleFilePath: string,
  entryKey: string,
): result.Result<{ jsonPath: string; importPath: string }, PatchSourceError> {
  const base = moduleFilePath.endsWith(VAL_TS_SUFFIX)
    ? moduleFilePath.slice(0, -VAL_TS_SUFFIX.length)
    : moduleFilePath;
  const keyRel = entryKey.replace(/^\//, "");
  const invalid = (reason: string) =>
    result.err<PatchSourceError>({
      message: `Invalid .jsonValues() entry key '${entryKey}' in ${moduleFilePath}: ${reason}`,
      filePath: moduleFilePath,
    });
  // An entry key is CLIENT-SUPPLIED — it arrives as a record key in a patch op —
  // and this path is what the commit writes to disk. Left unchecked, a key with
  // `..` segments (or a backslash, which is a separator once the path is handed
  // to node's `path.join` on Windows) puts that write anywhere in the project or
  // outside it entirely, and a `move` additionally deletes the source path.
  if (keyRel === "") {
    return invalid("it is empty");
  }
  if (keyRel.includes("\\") || keyRel.includes("\0")) {
    return invalid("it contains a backslash or a NUL byte");
  }
  const jsonPath = path.posix.normalize(`${base}/${keyRel}.val.json`);
  if (!jsonPath.startsWith(`${base}/`)) {
    return invalid(`it resolves outside '${base}/'`);
  }
  const moduleDir = path.posix.dirname(moduleFilePath);
  let importPath = path.posix.relative(moduleDir, jsonPath);
  if (!importPath.startsWith(".")) {
    importPath = `./${importPath}`;
  }
  return result.ok({ jsonPath, importPath });
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

/** The outcome of replaying pending patches onto one `.jsonValues()` entry. */
export type JsonEntryResolution =
  | { kind: "content"; content: JSONValue | null; appliedPatchIds: PatchId[] }
  | { kind: "deleted"; appliedPatchIds: PatchId[] }
  | { kind: "error"; message: string; patchId?: PatchId };

/**
 * Replays the ops of `patches` that target ONE `.jsonValues()` entry onto its
 * committed content, yielding the entry's draft content.
 *
 * This is the read-side counterpart to the commit flow in `ValOps.prepare`:
 * both route ops with {@link classifyJsonValuesOp} and replay content sub-ops
 * with {@link rebaseContentOp}, but this one produces a value instead of files
 * and never touches the `.val.ts`.
 *
 * Root-only, like the rest of the `.jsonValues()` machinery: ops targeting a
 * nested record are ignored (nested `.jsonValues()` is rejected at startup).
 */
export function applyJsonValuesEntryPatches(args: {
  serializedSchema: SerializedSchema | undefined;
  entryKey: string;
  /** `undefined` when the entry does not exist in the committed source. */
  baseContent: JSONValue | undefined;
  /** Ordered, already filtered to the entry's module. */
  patches: { patchId: PatchId; patch: Patch }[];
}): JsonEntryResolution {
  const { serializedSchema, entryKey, baseContent, patches } = args;
  let content: JSONValue | undefined = baseContent;
  let deleted = false;
  const appliedPatchIds: PatchId[] = [];
  for (const { patchId, patch } of patches) {
    let touched = false;
    for (const rawOp of patch) {
      /**
       * A write of the WHOLE record fans out into per-entry ops first.
       *
       * Through the same {@link expandJsonValuesRootOp} the commit flow uses,
       * against the same view of this entry: present or not, and with what
       * content. That is what makes the draft this produces and the files a
       * publish writes agree - two expansions of one rule would not.
       */
      let ops: Operation[] = [rawOp];
      if (serializedSchema && isJsonValuesRootOp(serializedSchema, rawOp)) {
        const expanded = expandJsonValuesRootOp(
          rawOp,
          new Map(content === undefined ? [] : [[entryKey, content]]),
        );
        if (result.isErr(expanded)) {
          return { kind: "error", message: expanded.error.message, patchId };
        }
        ops = expanded.value;
      }
      for (const op of ops) {
        const cls = serializedSchema
          ? classifyJsonValuesOp(serializedSchema, op.path)
          : ({ kind: "normal" } as const);
        if (
          cls.kind !== "entry" ||
          cls.recordPath.length > 0 ||
          cls.entryKey !== entryKey
        ) {
          continue;
        }
        touched = true;
        // A file op does not edit the entry's content — its bytes go through the
        // upload pipeline. What the entry needs is the `patch_id` saying those
        // bytes are not committed yet, so `mediaUrl` serves them from the patch
        // directory instead of a `/public` path that holds nothing. Without this a
        // just-uploaded image inside an entry renders broken.
        if (op.op === "file") {
          if (op.value === null || content === undefined) {
            // A delete carries no bytes to point at, and there is nothing to mark
            // on an entry that does not exist.
            continue;
          }
          const applied = applyPatch(deepClone(content), jsonOps, [
            {
              op: "add",
              path: cls.subPath
                .concat(...(op.nestedFilePath ?? []))
                .concat("patch_id"),
              value: patchId,
            },
          ]);
          if (result.isErr(applied)) {
            return { kind: "error", message: applied.error.message, patchId };
          }
          content = applied.value;
          continue;
        }
        if (cls.subPath.length === 0) {
          if (op.op === "add" || op.op === "replace") {
            content = op.value as JSONValue;
            deleted = false;
          } else if (op.op === "remove") {
            content = undefined;
            deleted = true;
          } else if (op.op === "test") {
            // An assertion, not a mutation: the content is unchanged either way, and
            // the commit path is where a failing `test` is reported. Falling through
            // to the move/copy error below turned a no-op into a permanent load
            // failure for the whole entry.
            continue;
          } else {
            // move/copy INTO this key: the content comes from the source entry,
            // which the caller must resolve (it is a different `*.val.json`).
            return {
              kind: "error",
              message: `Cannot resolve '${op.op}' of jsonValues entry '${entryKey}' from its own content`,
              patchId,
            };
          }
          continue;
        }
        if (content === undefined) {
          return {
            kind: "error",
            message: `Cannot edit jsonValues entry '${entryKey}': it does not exist`,
            patchId,
          };
        }
        const rebased = rebaseContentOp(op, cls.recordPath.length + 1);
        if (result.isErr(rebased)) {
          return { kind: "error", message: rebased.error.message, patchId };
        }
        const applied = applyPatch(deepClone(content), jsonOps, [
          rebased.value,
        ]);
        if (result.isErr(applied)) {
          return { kind: "error", message: applied.error.message, patchId };
        }
        content = applied.value;
      }
    }
    if (touched) {
      appliedPatchIds.push(patchId);
    }
  }
  if (deleted || content === undefined) {
    return { kind: "deleted", appliedPatchIds };
  }
  return { kind: "content", content, appliedPatchIds };
}

/**
 * Resolves an EXISTING entry's `*.val.json` path (relative to rootDir) from the
 * `import(...)` path recorded in the `.val.ts` thunk (from
 * {@link analyzeJsonValuesEntries}). Existing files may have been hand-placed,
 * so the import path is authoritative (hybrid authoring).
 */
export function resolveExistingJsonPath(
  moduleFilePath: string,
  importPath: string,
): string {
  const moduleDir = path.posix.dirname(moduleFilePath);
  return path.posix.join(moduleDir, importPath);
}
