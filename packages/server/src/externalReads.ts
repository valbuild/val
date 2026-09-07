import {
  Internal,
  RecordSchema,
  type Json,
  type ModuleFilePath,
  type Schema,
  type SelectorSource,
  type SerializedSchema,
  type Source,
  type SourcePath,
  type ValidationError,
} from "@valbuild/core";
import type { PatchId } from "@valbuild/core";
import type { JSONValue, Patch } from "@valbuild/core/patch";
import {
  applyJsonValuesEntryPatches,
  classifyEntryOp,
} from "./patch/jsonValuesPatch";

/**
 * Reading an external record: what the entries ARE, once the store, the module
 * source and the unpublished edits have all had their say.
 *
 * Three things sit between an adapter's answer and what an editor should see,
 * and none of them belongs in the adapter:
 *
 * - **Inline entries shadow the store.** Content pasted straight into the
 *   `.val.ts` is legal (see `InlineEntriesFor`) and is what an author writes
 *   first. It reads as written, and for its own keys it wins — otherwise moving
 *   content into a store would make the not-yet-moved half disappear.
 * - **Unpublished edits are applied on top.** A draft is not in the store; the
 *   store has published content only. Without this an editor would open a record
 *   and see their own edit missing.
 * - **Content is validated as it is read, and degrades.** The store is not the
 *   repository: its rows can change under a schema that no longer describes
 *   them. A row that does not validate is reported, never thrown — one bad row
 *   must not empty a page.
 *
 * Pure functions, so the whole of it is testable without a store, a filesystem
 * or a `ValOps`.
 */

/** What the module source holds where an external record's entries would be. */
export type ExternalSourceShape =
  | { kind: "marker" }
  /** Entries written inline in the `.val.ts` — legal, and reported as a fix. */
  | { kind: "inline"; entries: Record<string, Json> }
  /** Anything else: reported, never guessed at. */
  | { kind: "invalid"; message: string };

export function readExternalSource(
  source: Source | undefined,
): ExternalSourceShape {
  if (source === undefined || source === null) {
    return {
      kind: "invalid",
      message: "The module has no source",
    };
  }
  if (Internal.isExternal(source)) {
    return { kind: "marker" };
  }
  if (typeof source !== "object" || Array.isArray(source)) {
    return {
      kind: "invalid",
      message: `An external record's source must be c.external() or entries written inline, got: ${typeof source}`,
    };
  }
  return { kind: "inline", entries: source as Record<string, Json> };
}

/**
 * The keys unpublished edits add and remove at a record's root.
 *
 * Paging happens in the store, which has never heard of a draft, so draft-added
 * keys have to be spliced in by whoever asked for a page — and draft-removed
 * ones taken out. Both are few: a draft is one editor's in-flight work, not a
 * second copy of the record.
 */
export function draftKeyChanges(
  serializedSchema: SerializedSchema | undefined,
  patches: { patchId: PatchId; patch: Patch }[],
): { added: string[]; removed: Set<string> } {
  const added: string[] = [];
  const removed = new Set<string>();
  if (serializedSchema === undefined) {
    return { added, removed };
  }
  for (const { patch } of patches) {
    for (const op of patch) {
      const cls = classifyEntryOp(serializedSchema, op.path, "external");
      // Root-only, like the rest of the external machinery: a nested record is
      // rejected at startup, so an op that reaches one is not ours to read.
      if (cls.kind !== "entry" || cls.recordPath.length > 0) {
        continue;
      }
      if (cls.subPath.length > 0) {
        // An edit INSIDE an entry. It neither adds nor removes a key — but it
        // does resurrect one a previous patch removed, in the same order the
        // ops were made.
        continue;
      }
      if (op.op === "add" || op.op === "replace") {
        removed.delete(cls.entryKey);
        if (!added.includes(cls.entryKey)) {
          added.push(cls.entryKey);
        }
      } else if (op.op === "remove") {
        removed.add(cls.entryKey);
        const at = added.indexOf(cls.entryKey);
        if (at !== -1) {
          added.splice(at, 1);
        }
      }
    }
  }
  return { added, removed };
}

/**
 * Every key an unpublished edit mentions at all, added and removed included.
 *
 * Broader than {@link draftKeyChanges} on purpose: an edit INSIDE an entry
 * changes no keys, but it is exactly the change a delegated search cannot see —
 * the store answered from published content, and the words the editor just typed
 * are not in it.
 */
export function draftTouchedKeys(
  serializedSchema: SerializedSchema | undefined,
  patches: { patchId: PatchId; patch: Patch }[],
): string[] {
  const keys: string[] = [];
  if (serializedSchema === undefined) {
    return keys;
  }
  for (const { patch } of patches) {
    for (const op of patch) {
      const cls = classifyEntryOp(serializedSchema, op.path, "external");
      if (cls.kind !== "entry" || cls.recordPath.length > 0) {
        continue;
      }
      if (!keys.includes(cls.entryKey)) {
        keys.push(cls.entryKey);
      }
    }
  }
  return keys;
}

export type ExternalEntry = { key: string; content: Json | null };

export type ExternalEntriesResolution = {
  entries: ExternalEntry[];
  /** Keys that exist nowhere: not in the store, not inline, not in a draft. */
  missing: string[];
  errors: { key: string; message: string }[];
};

/**
 * Resolve the content of the requested keys.
 *
 * `fromStore` is what the adapter answered — `null` for a key it does not have.
 * Everything else here is Val's own: inline entries shadow it, pending patches
 * are replayed on top, and the item schema is checked against the result.
 */
export function resolveExternalEntries(args: {
  moduleFilePath: ModuleFilePath;
  schema: Schema<SelectorSource> | undefined;
  serializedSchema: SerializedSchema | undefined;
  source: Source | undefined;
  keys: string[];
  fromStore: Record<string, Json | null>;
  patches: { patchId: PatchId; patch: Patch }[];
  /**
   * Whether to replay pending patches. The Studio owns its own in-flight
   * patches and passes `false`, or the same edit is applied twice.
   */
  applyPatches: boolean;
  /**
   * Whether to check each entry against the item schema.
   *
   * On by default, and worth the cost: an external store's rows can change under
   * a schema that no longer describes them, which cannot happen to content that
   * lives in the repository.
   */
  validate?: boolean;
}): ExternalEntriesResolution {
  const {
    moduleFilePath,
    schema,
    serializedSchema,
    source,
    keys,
    fromStore,
    patches,
    applyPatches,
  } = args;
  const validate = args.validate !== false;
  const shape = readExternalSource(source);
  const inline = shape.kind === "inline" ? shape.entries : {};

  const entries: ExternalEntry[] = [];
  const missing: string[] = [];
  const errors: { key: string; message: string }[] = [];

  for (const key of keys) {
    // Inline wins: content half-moved into a store must not read as gone.
    const base = key in inline ? inline[key] : (fromStore[key] ?? undefined);
    let content: JSONValue | null | undefined =
      base === undefined ? undefined : toMutableJson(base);
    if (applyPatches) {
      const res = applyJsonValuesEntryPatches({
        serializedSchema,
        entryKey: key,
        baseContent: content,
        patches,
        kind: "external",
      });
      if (res.kind === "error") {
        errors.push({ key, message: res.message });
        continue;
      }
      if (res.kind === "deleted") {
        missing.push(key);
        continue;
      }
      content = res.content;
    }
    if (content === undefined) {
      missing.push(key);
      continue;
    }
    if (validate) {
      // The KEY is checked too, not only the content. An external router's keys
      // arrive a page at a time from the store, so a check over "the whole key
      // set" would check nothing — and looking like a check is worse than not
      // having one.
      const keyMessage = validateExternalKey(schema, moduleFilePath, key);
      if (keyMessage !== null) {
        errors.push({ key, message: keyMessage });
      }
    }
    if (validate && content !== null) {
      const message = validateExternalEntry(
        schema,
        moduleFilePath,
        key,
        content,
      );
      if (message !== null) {
        // Reported per key and the entry still returned: a row that no longer
        // matches the schema is exactly what an editor has to SEE in order to
        // fix it. Dropping it would leave a gap in the page instead.
        errors.push({ key, message });
      }
    }
    entries.push({ key, content });
  }
  return { entries, missing, errors };
}

/**
 * Check one entry KEY against the record's router, if it has one.
 *
 * A record with no router has nothing to say about its keys, so this is `null`
 * for everything but an `s.router()`.
 */
export function validateExternalKey(
  schema: Schema<SelectorSource> | undefined,
  moduleFilePath: ModuleFilePath,
  key: string,
): string | null {
  if (!(schema instanceof RecordSchema)) {
    return null;
  }
  let errors: Record<SourcePath, ValidationError[]> | false;
  try {
    errors = schema.validateRecordKeys(moduleFilePath as string as SourcePath, [
      key,
    ]);
  } catch (e) {
    return `Could not validate key '${key}': ${
      e instanceof Error ? e.message : String(e)
    }`;
  }
  if (errors === false) {
    return null;
  }
  const messages = Object.values(errors).flatMap((errs) =>
    errs.map((err) => err.message),
  );
  if (messages.length === 0) {
    return null;
  }
  return messages.join("; ");
}

/**
 * Check one entry against the record's item schema.
 *
 * Returns a message rather than throwing, and returns `null` when the schema
 * cannot say anything — a read must degrade, never fail, on a schema it cannot
 * use.
 */
/**
 * A fresh, mutable copy of what the store handed back.
 *
 * Two reasons, and either would be enough. `Json` is deeply readonly and the
 * patch machinery mutates, so the types disagree by design. And an adapter is
 * free to answer from a cache — handing that object to patch replay would let
 * Val's draft edits mutate the store's own cached row.
 */
function toMutableJson(value: Json): JSONValue {
  return JSON.parse(JSON.stringify(value));
}

export function validateExternalEntry(
  schema: Schema<SelectorSource> | undefined,
  moduleFilePath: ModuleFilePath,
  key: string,
  content: Json,
): string | null {
  if (!(schema instanceof RecordSchema)) {
    return null;
  }
  const entryPath = Internal.createValPathOfItem(
    moduleFilePath as string as SourcePath,
    key,
  );
  if (!entryPath) {
    return null;
  }
  let errors: Record<SourcePath, ValidationError[]> | false;
  try {
    errors = schema.validateJsonEntryContent(entryPath, content);
  } catch (e) {
    // A schema that throws while validating is a bug, but it is not this read's
    // bug: report it against the entry and let the rest of the page through.
    return `Could not validate entry '${key}': ${
      e instanceof Error ? e.message : String(e)
    }`;
  }
  if (errors === false) {
    return null;
  }
  const flattened = Object.entries(errors).flatMap(([path, errs]) =>
    errs.map((err) => `${path}: ${err.message}`),
  );
  if (flattened.length === 0) {
    return null;
  }
  return `Entry '${key}' does not match the schema: ${flattened.join("; ")}`;
}

/**
 * Splice a store's page of keys together with what the module and the drafts
 * say.
 *
 * Inline and draft-added keys go on the FIRST page — the one asked for with a
 * null cursor — because there is nowhere else to put them: the store's cursors
 * are the store's, and a key it has never heard of cannot be positioned within
 * them. They are few by construction, so the first page grows a little rather
 * than paging becoming Val's problem.
 */
export function mergeExternalKeys(args: {
  fromStore: string[];
  storeCursor: string | null;
  /** Keys written inline in the `.val.ts`. */
  inline: string[];
  draft: { added: string[]; removed: Set<string> };
  isFirstPage: boolean;
}): { keys: string[]; cursor: string | null } {
  const { fromStore, storeCursor, inline, draft, isFirstPage } = args;
  const seen = new Set<string>();
  const keys: string[] = [];
  const push = (key: string) => {
    if (draft.removed.has(key) || seen.has(key)) {
      return;
    }
    seen.add(key);
    keys.push(key);
  };
  if (isFirstPage) {
    for (const key of inline) {
      push(key);
    }
    for (const key of draft.added) {
      push(key);
    }
  } else {
    // Not the first page, but still not allowed to repeat what went on it.
    for (const key of inline) {
      seen.add(key);
    }
    for (const key of draft.added) {
      seen.add(key);
    }
  }
  for (const key of fromStore) {
    push(key);
  }
  return { keys, cursor: storeCursor };
}
