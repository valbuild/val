import {
  VAL_EXTENSION,
  type ModuleFilePath,
  type PatchId,
  type SerializedSchema,
  type Source,
} from "@valbuild/core";
import { array, result } from "@valbuild/core/fp";
import {
  applyPatch,
  deepClone,
  JSONOps,
  PatchError,
  type JSONValue,
  type Operation,
  type Patch,
  type ReadonlyJSONValue,
} from "@valbuild/core/patch";
import {
  classifyJsonValuesOp,
  expandJsonValuesRootOp,
  expandJsonValuesRootOpForKey,
  isJsonValuesRootOp,
  rebaseContentOp,
  wholeEntryKey,
} from "@valbuild/shared/internal";

/*
 * THE OLD ENGINE, kept for one reason: the conformance cases
 * (`engineConformance.test.ts`) run every case against it and against the
 * engine that replaced it (`applyChain.ts` in `@valbuild/shared`), so a
 * difference between the two is found rather than assumed.
 *
 * TEST-ONLY. Nothing in the product imports this file, and nothing may: the
 * product applies patches with `applyPatchRecord` and nothing else. It is the
 * code that was `ValOps.getSources`'s patch loop and
 * `applyJsonValuesEntryPatches` in `./jsonValuesPatch`, moved here unchanged
 * apart from what a free function needs instead of `this` (the logging is
 * dropped). Delete it with the conformance test once nobody needs the old
 * engine's answers to compare with.
 */

const jsonOps = new JSONOps();

type Sources = Record<ModuleFilePath, Source>;
type GenericErrorMessage = { message: string };

/** `ValOps.getSources(analysis)` as it was: the modules that had patches. */
export function legacyGetSources(
  sources: Sources,
  jsonValuesSchemaFor: (path: ModuleFilePath) => SerializedSchema | undefined,
  analysis: {
    patches: { path: ModuleFilePath; patchId: PatchId; patch: Patch }[];
  },
): {
  sources: Sources;
  errors: Record<
    ModuleFilePath,
    { patchId: PatchId; skipped: boolean; error: GenericErrorMessage }[]
  >;
} {
  const patchedSources: Sources = {};
  const errors: Record<
    ModuleFilePath,
    { patchId: PatchId; skipped: boolean; error: GenericErrorMessage }[]
  > = {};
  for (const patchData of analysis.patches) {
    const path = patchData.path;
    if (sources[path] === undefined) {
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push({
        patchId: patchData.patchId,
        skipped: true,
        error: new PatchError(`Module not found`),
      });
      continue;
    }
    if (!patchedSources[path]) {
      patchedSources[path] = sources[path];
    }
    const patchId = patchData.patchId;
    if (errors[path]) {
      errors[path].push({
        patchId: patchId,
        skipped: true,
        error: new PatchError(`Cannot apply patch: previous errors exists`),
      });
    } else {
      const applicableOps: Patch = [];
      const fileFixOps: Record<string, Patch> = {};
      // `.jsonValues()` entry values are opaque `{_type:"json"}` markers in
      // the module source — their content lives in the entry's `*.val.json`.
      // Ops that reach INTO an entry therefore cannot be applied here (and
      // would fail with "Cannot replace object element which does not exist",
      // poisoning the rest of this module's patch chain). See the per-op
      // routing below.
      const serializedSchema = jsonValuesSchemaFor(path);
      /**
       * The record's keys as they stand while this patch is walked.
       *
       * Only the key set: the module source holds markers, so there is no
       * content here to compare a whole-record write against. Seeded from the
       * source and kept current as the ops below add and remove entries,
       * because `patchedSources` is only written once the whole patch has
       * been applied.
       */
      let entryKeys: Map<string, JSONValue | undefined> | null = null;
      const currentEntryKeys = (): Map<string, JSONValue | undefined> => {
        if (entryKeys === null) {
          entryKeys = new Map();
          const source = patchedSources[path];
          if (
            typeof source === "object" &&
            source !== null &&
            !Array.isArray(source)
          ) {
            for (const key of Object.keys(source)) {
              entryKeys.set(key, undefined);
            }
          }
        }
        return entryKeys;
      };
      /**
       * Set when a whole-record write could not be expanded.
       *
       * Nothing of this patch is applied then: the ops before the failure are
       * half of an edit, and half of a record write is a record missing
       * entries.
       */
      let unexpandable = false;
      for (const rawOp of patchData.patch) {
        /**
         * A write of the WHOLE record fans out into per-entry ops first,
         * through the same expansion the commit flow and the entry read path
         * use. Left as it is, a root write would put the value straight into
         * the module source - where the entries are markers, so the record
         * would hold content the Studio then tries to load as entries.
         */
        let ops: Operation[] = [rawOp];
        if (serializedSchema && isJsonValuesRootOp(serializedSchema, rawOp)) {
          const expandedRes = expandJsonValuesRootOp(rawOp, currentEntryKeys());
          if (result.isErr(expandedRes)) {
            if (!errors[path]) {
              errors[path] = [];
            }
            errors[path].push({
              patchId,
              skipped: false,
              error: expandedRes.error,
            });
            unexpandable = true;
            break;
          }
          ops = expandedRes.value;
        }
        for (const op of ops) {
          if (op.op === "file") {
            // A file op inside a `.jsonValues()` entry has nothing to inject
            // HERE: the entry is an opaque marker in the module source, so an
            // `add` reaching into it fails and poisons the rest of this
            // module's chain. `applyJsonValuesEntryPatches` writes the patch_id
            // into the entry's draft content instead.
            const fileCls = serializedSchema
              ? classifyJsonValuesOp(serializedSchema, op.path)
              : ({ kind: "normal" } as const);
            if (fileCls.kind === "entry" && fileCls.subPath.length > 0) {
              continue;
            }
            if (op.value !== null) {
              // NOTE: We insert the last patch_id that modify a file
              // when constructing the url we use the patch id (and the file path)
              // to fetch the right file
              // NOTE: overwrite and use last patch_id if multiple patches modify the same file
              //
              // Keyed by where the patch_id LANDS — the field's path plus
              // `nestedFilePath` — not by the field's path alone. A video's
              // poster and caption files are file ops on the video's own path
              // with `nestedFilePath` ["poster"] / ["captions", "0"]; keyed by
              // `op.path` they overwrote the video's entry (and each other),
              // so only one of the files got a patch_id and the rest were
              // looked for at a published URL that holds nothing. JSON rather
              // than a "/" join because a segment can contain "/" (a gallery
              // key is a file path).
              const patchIdPath = op.path
                .concat(...(op.nestedFilePath || []))
                .concat("patch_id");
              fileFixOps[JSON.stringify(patchIdPath)] = [
                {
                  op: "add",
                  path: patchIdPath,
                  value: patchId,
                },
              ];
            }
            // null value = delete: no patch_id to inject; the "remove" op in
            // the patch already removes the metadata entry from the source
          } else {
            const cls = serializedSchema
              ? classifyJsonValuesOp(serializedSchema, op.path)
              : ({ kind: "normal" } as const);
            if (cls.kind === "normal") {
              applicableOps.push(op);
            } else if (cls.subPath.length > 0) {
              // Content edit inside an entry: the module source is genuinely
              // unaffected (the content lives in the `*.val.json`), so skip it.
              // Draft content is served by the single-entry `/json` endpoint.
            } else if (op.op === "add" || op.op === "replace") {
              // Whole-entry add/replace: keep the record's KEY SET correct for
              // drafts by writing the marker rather than the content. Record
              // validation only asserts `isJson`, and
              // `validateJsonValuesEntries` skips thunkless markers by design.
              applicableOps.push({
                op: op.op,
                path: op.path,
                value: {
                  [VAL_EXTENSION]: "json",
                  patch_id: patchId,
                } as JSONValue,
              } as Operation);
              currentEntryKeys().set(cls.entryKey, undefined);
            } else if (op.op === "remove") {
              applicableOps.push(op);
              currentEntryKeys().delete(cls.entryKey);
            } else {
              // move/copy of a whole entry: the destination key must appear, and
              // for a move the source key must disappear. Both are key-set
              // changes we can express with markers.
              applicableOps.push({
                op: "add",
                path: op.path,
                value: {
                  [VAL_EXTENSION]: "json",
                  patch_id: patchId,
                } as JSONValue,
              } as Operation);
              currentEntryKeys().set(cls.entryKey, undefined);
              if (op.op === "move" && array.isNonEmpty(op.from)) {
                applicableOps.push({ op: "remove", path: op.from });
                if (op.from.length === 1) {
                  currentEntryKeys().delete(op.from[0]);
                }
              }
            }
          }
        }
      }
      if (unexpandable) {
        continue;
      }
      const patchRes = applyPatch(
        deepClone(patchedSources[path] as ReadonlyJSONValue) as JSONValue, // applyPatch mutates the source. On add operations it adds more than once? There is something strange going on... deepClone seems to fix, but is that the right solution?
        jsonOps,
        applicableOps.concat(...Object.values(fileFixOps)),
      );
      if (result.isErr(patchRes)) {
        if (!errors[path]) {
          errors[path] = [];
        }
        errors[path].push({
          patchId: patchId,
          skipped: false,
          error: patchRes.error,
        });
      } else {
        patchedSources[path] = patchRes.value;
      }
    }
  }
  return { sources: patchedSources, errors };
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
export function legacyApplyJsonValuesEntryPatches(args: {
  serializedSchema: SerializedSchema | undefined;
  entryKey: string;
  /** `undefined` when the entry does not exist in the committed source. */
  baseContent: JSONValue | undefined;
  /** Ordered, already filtered to the entry's module. */
  patches: { patchId: PatchId; patch: Patch }[];
  /**
   * The committed content of the OTHER entries of the record, for a
   * whole-entry `move` or `copy` into this key: its content is the source
   * entry's at that point in the chain, which is a different `*.val.json`.
   *
   * `undefined` for an entry the caller did not load, and then such an op is
   * an error, as it is when this is not given at all. `{ content: undefined }`
   * is an entry the committed source does not have.
   */
  baseContentOf?: (
    entryKey: string,
  ) => { content: JSONValue | undefined } | undefined;
  /**
   * Replay only the ops before this one: patch index, then op index in it.
   * How a move's source is read as it stood when the move was made.
   */
  stopBefore?: { patch: number; op: number };
}): JsonEntryResolution {
  const {
    serializedSchema,
    entryKey,
    baseContent,
    patches,
    baseContentOf,
    stopBefore,
  } = args;
  let content: JSONValue | undefined = baseContent;
  let deleted = false;
  const appliedPatchIds: PatchId[] = [];
  replay: for (const [patchIndex, { patchId, patch }] of patches.entries()) {
    let touched = false;
    for (const [opIndex, rawOp] of patch.entries()) {
      if (
        stopBefore &&
        (patchIndex > stopBefore.patch ||
          (patchIndex === stopBefore.patch && opIndex >= stopBefore.op))
      ) {
        break replay;
      }
      /**
       * A write of the WHOLE record becomes what it says about THIS entry.
       *
       * Through the same rule the commit flow expands with, against the same
       * view of this entry: present or not, and with what content. That is what
       * makes the draft this produces and the files a publish writes agree -
       * two expansions of one rule would not.
       */
      let ops: Operation[] = [rawOp];
      if (serializedSchema && isJsonValuesRootOp(serializedSchema, rawOp)) {
        const write = expandJsonValuesRootOpForKey(
          rawOp,
          entryKey,
          new Map(content === undefined ? [] : [[entryKey, content]]),
        );
        if (result.isErr(write)) {
          return { kind: "error", message: write.error.message, patchId };
        }
        ops = write.value === null ? [] : [write.value];
      }
      for (const op of ops) {
        const cls = serializedSchema
          ? classifyJsonValuesOp(serializedSchema, op.path)
          : ({ kind: "normal" } as const);
        if (
          op.op === "move" &&
          wholeEntryKey(serializedSchema, op.from) === entryKey &&
          wholeEntryKey(serializedSchema, op.path) !== entryKey
        ) {
          // Moved AWAY: under its old key, the entry is gone.
          touched = true;
          content = undefined;
          deleted = true;
          continue;
        }
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
            // as it stood at this op (it is a different `*.val.json`).
            const fromKey = wholeEntryKey(serializedSchema, op.from);
            const fromBase =
              fromKey === undefined ? undefined : baseContentOf?.(fromKey);
            if (fromKey !== undefined && fromBase !== undefined) {
              const source = legacyApplyJsonValuesEntryPatches({
                serializedSchema,
                entryKey: fromKey,
                baseContent: fromBase.content,
                patches,
                baseContentOf,
                stopBefore: { patch: patchIndex, op: opIndex },
              });
              if (source.kind === "error") {
                return source;
              }
              if (source.kind === "content") {
                content = deepClone(source.content);
                deleted = false;
                continue;
              }
            }
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
