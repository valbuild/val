import {
  Internal,
  type Json,
  type PatchId,
  type SerializedSchema,
} from "@valbuild/core";
import {
  EMPTY_CHAIN,
  applyPatchRecord,
  baseModuleContent,
  entryState,
  extendChain,
  resolveEntry,
  type EntryContent,
  type EntryState,
  type HeldOps,
  type ModuleContent,
  type ModuleVersion,
  type PatchRecord,
} from "@valbuild/shared/internal";

/*
 * The Studio's view of a module: the module at the version the server names
 * for it, with what this Studio wrote that the server has not got yet on top,
 * through THE engine (`applyPatchRecord` in `@valbuild/shared`, which Val's
 * server applies patches with too). See `docs/plans/one-content-model.md`,
 * "The Studio loads everything from one place", phases 5 and 7.
 *
 * Two layers, as the plan draws them:
 *
 * - the SERVER's module, at the version the manifest names
 *   (`manifestSource.ts`): read from the store -- the versions this Studio
 *   computed itself ({@link VersionRing}, the memory tier), the bundle's own
 *   module, or its own server (`originTier.ts`, `GET /modules`, as the
 *   patches from the version held when it can);
 * - {@link withLocalEdits} -- what this Studio wrote that the server's
 *   version does not have yet, on top. The one layer only the Studio has,
 *   because only the Studio writes and typing cannot wait.
 *
 * Both keep their results by version, in one {@link VersionRing} per module
 * that holds the last two: so a keystroke extends the last result by its one
 * patch (one engine apply, risk 2 in the plan), the server confirming it costs
 * nothing (the version the manifest then names IS the one computed here, so
 * the ring answers it), and a discard of the newest patch is the version
 * before it, kept.
 *
 * Nothing here mutates. The engine copies along each patch's path and shares
 * the rest, so a path whose value did not move is `===` across versions
 * (risk 5), which is how {@link SourceStore} decides who to wake after a
 * rebuild.
 */

/** A module as the engine made it from a base and a chain. */
export type ModuleAt = {
  /** The schema's, the base's and the chain of {@link applied}. */
  readonly version: ModuleVersion;
  /** What of the schema the engine read: see {@link engineSchemaKey}. */
  readonly engine: string;
  readonly content: ModuleContent;
  /** Every patch of the chain this was computed for, in order. */
  readonly tried: readonly PatchId[];
  /** Those that applied: what {@link version}'s chain folds. */
  readonly applied: readonly PatchId[];
  /** Those that did not, and why. */
  readonly failed: readonly { patchId: PatchId; message: string }[];
};

/** What a module is computed from, beside the patches applied. */
export type ModuleInputs = {
  readonly schema: SerializedSchema | undefined;
  readonly schemaVersion: string;
  /** {@link engineSchemaKey} of {@link schema}. */
  readonly engineKey: string;
  /** The base source, `.jsonValues()` entries as markers. */
  readonly base: Json;
  readonly baseVersion: string;
  /** Told once per patch the engine applies, with what it applied. */
  readonly onApply?: (patchId: PatchId) => void;
};

/**
 * A chain stops at nothing here: a patch that does not apply is passed over,
 * and the ones after it still apply.
 *
 * The server's `applyChain` stops at the first failing patch instead. The two
 * differ only for as long as the failing patch exists: the Studio discards a
 * patch that does not apply (`discardUnapplicable` in `createSystem`), and
 * once it is gone the server's chain is the same ids this one applied -- so
 * the same version. Stopping here would hold every later edit back behind a
 * delete that is already on its way. The version names what was applied, so
 * it never claims a patch it passed over.
 */
function extend(
  from: ModuleAt,
  records: readonly PatchRecord[],
  inputs: ModuleInputs,
): ModuleAt {
  if (records.length === 0) return from;
  let content = from.content;
  let chain = from.version.chain;
  const tried = [...from.tried];
  const applied = [...from.applied];
  const failed = [...from.failed];
  for (const record of records) {
    tried.push(record.patchId);
    inputs.onApply?.(record.patchId);
    const res = applyPatchRecord(content, record, inputs.schema);
    if (res.status === "failed") {
      failed.push({ patchId: res.patchId, message: res.message });
      continue;
    }
    // An edit inside a loaded `.jsonValues()` entry that does not fit it is
    // the entry's error, not the module's: the engine records it and goes on.
    // Here it is the patch's, like any other that does not apply.
    const entryError = entryErrorOf(res.module, record);
    if (entryError !== null) {
      failed.push({ patchId: record.patchId, message: entryError });
      continue;
    }
    content = res.module;
    applied.push(record.patchId);
    chain = extendChain(chain, record.patchId);
  }
  return {
    version: {
      schema: inputs.schemaVersion,
      base: inputs.baseVersion,
      chain,
    },
    engine: inputs.engineKey,
    content,
    tried,
    applied,
    failed,
  };
}

/** The error this patch left in an entry it wrote into, if it did. */
function entryErrorOf(
  content: ModuleContent,
  record: PatchRecord,
): string | null {
  if (content.entries.size === 0) return null;
  for (const op of record.patch) {
    const keys = [op.path[0]];
    if (op.op === "move" || op.op === "copy") keys.push(op.from[0]);
    for (const key of keys) {
      if (key === undefined) continue;
      const state = content.entries.get(key);
      if (state?.kind === "error" && state.patchId === record.patchId) {
        return state.message;
      }
    }
  }
  return null;
}

/** The module at its base: no patch applied. */
export function baseAt(inputs: ModuleInputs): ModuleAt {
  return {
    version: {
      schema: inputs.schemaVersion,
      base: inputs.baseVersion,
      chain: EMPTY_CHAIN,
    },
    engine: inputs.engineKey,
    content: baseModuleContent(inputs.base),
    tried: [],
    applied: [],
    failed: [],
  };
}

/**
 * The last two versions of each module: the one shown, and the one before
 * it (a discard of the newest patch, an answer that lands late). What a
 * module costs in memory beyond its base is these two (risk 9 in the plan),
 * and older versions are recomputed from the base and the chain.
 */
export class VersionRing {
  static readonly KEPT = 2;
  private readonly kept = new Map<string, ModuleAt[]>();

  /**
   * The longest version kept for this module that was computed for a prefix
   * of `ids` (at most `max` of them), on this base and with what the engine
   * reads of this schema ({@link engineSchemaKey}).
   */
  longestPrefix(
    path: string,
    inputs: ModuleInputs,
    ids: readonly PatchId[],
    max: number,
  ): ModuleAt | null {
    let best: ModuleAt | null = null;
    for (const at of this.kept.get(path) ?? []) {
      if (
        at.engine !== inputs.engineKey ||
        at.version.base !== inputs.baseVersion ||
        at.tried.length > max ||
        (best !== null && at.tried.length <= best.tried.length) ||
        !isPrefix(at.tried, ids)
      ) {
        continue;
      }
      best = at;
    }
    return best;
  }

  /**
   * The version kept for this module with this base and chain, read with what
   * the engine reads of this schema: the memory tier, as the manifest asks
   * it. The version the server names for an edit this Studio made is the one
   * it computed (same schema, base and patches), so confirming costs nothing.
   */
  atVersion(
    path: string,
    inputs: Pick<ModuleInputs, "engineKey">,
    version: Pick<ModuleVersion, "base" | "chain">,
  ): ModuleAt | null {
    for (const at of this.kept.get(path) ?? []) {
      if (
        at.engine === inputs.engineKey &&
        at.version.base === version.base &&
        at.version.chain === version.chain
      ) {
        return at;
      }
    }
    return null;
  }

  /** Keep `at` as the newest version of `path`, dropping the oldest. */
  remember(path: string, at: ModuleAt): void {
    const kept = this.kept.get(path) ?? [];
    const next = [at, ...kept.filter((other) => other !== at)];
    next.length = Math.min(next.length, VersionRing.KEPT);
    this.kept.set(path, next);
  }

  forget(path: string): void {
    this.kept.delete(path);
  }

  /** How many versions are kept for `path`: the heap guard's count. */
  size(path: string): number {
    return this.kept.get(path)?.length ?? 0;
  }
}

function isPrefix(prefix: readonly PatchId[], of: readonly PatchId[]) {
  if (prefix.length > of.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== of[i]) return false;
  }
  return true;
}

/**
 * What this Studio has that the server's version `below` does not, on top of
 * it: the version a field shows. `below` is the module at the version the
 * manifest names (or the bundle's, before one has), and `local` the module's
 * patches it does not contain, in chain order -- normally this Studio's
 * edits the server has not confirmed. Kept per (version below, ids applied)
 * -- which is the version of the result -- and extended by the new patch
 * only: when a version at or past `below` is kept, nothing is applied again.
 */
export function withLocalEdits(
  path: string,
  below: {
    /** The patch ids the server's version is made of. */
    readonly tried: readonly PatchId[];
    /** Its content: asked for only when no kept version extends it. */
    readonly at: () => ModuleAt;
  },
  local: readonly PatchRecord[],
  inputs: ModuleInputs,
  ring: VersionRing,
): ModuleAt {
  const ids = [...below.tried, ...local.map((record) => record.patchId)];
  const kept = ring.longestPrefix(path, inputs, ids, ids.length);
  const from = withSchema(
    kept !== null && kept.tried.length >= below.tried.length
      ? kept
      : below.at(),
    inputs,
  );
  const at = extend(
    from,
    local.slice(from.tried.length - below.tried.length),
    inputs,
  );
  ring.remember(path, at);
  return at;
}

/**
 * `at` under this schema: the same content, a version naming this schema.
 *
 * The content cannot differ: a version is reused only for a schema the engine
 * reads the same ({@link engineSchemaKey}). So a code change that does not
 * move a module's `.jsonValues()` records changes the version a module is at
 * and not one object of what is shown -- nothing is applied again, and
 * nothing that reads the content is told it moved.
 */
function withSchema(at: ModuleAt, inputs: ModuleInputs): ModuleAt {
  if (at.version.schema === inputs.schemaVersion) return at;
  return { ...at, version: { ...at.version, schema: inputs.schemaVersion } };
}

/**
 * The base with some patches applied and nothing kept: what has been
 * published, before a deployment moves the base (`SourceStore.peekBase`),
 * what a publish bakes into it, or a module at a version the store does not
 * hold, from its base and its chain (a discard of a patch the server has).
 */
export function applyOnBase(
  inputs: ModuleInputs,
  records: readonly PatchRecord[],
): ModuleAt {
  return extend(baseAt(inputs), records, inputs);
}

/**
 * A module as the SERVER answered it (`GET /modules`, `originTier.ts`): its
 * content at `version`, made of `patches`. Under this Studio's schema: the
 * content is the server's, and a field reads it with the schema it has.
 */
export function serverAt(
  module: {
    version: ModuleVersion;
    content: ModuleContent;
    patches: readonly PatchId[];
  },
  inputs: ModuleInputs,
): ModuleAt {
  return {
    version: { ...module.version, schema: inputs.schemaVersion },
    engine: inputs.engineKey,
    content: module.content,
    tried: module.patches,
    applied: module.patches,
    failed: [],
  };
}

/**
 * `at`, extended by the patches of a delta the server answered: the module at
 * the version the delta goes `to`. `null` when one of them does not apply
 * here, which the server's own version says cannot happen -- the caller asks
 * for the whole module instead.
 */
export function extendBy(
  at: ModuleAt,
  records: readonly PatchRecord[],
  inputs: ModuleInputs,
): ModuleAt | null {
  const next = extend(at, records, inputs);
  return next.failed.length > at.failed.length ? null : next;
}

/**
 * What the engine reads of a schema: where its `.jsonValues()` records are
 * (`classifyJsonValuesOp`, `isJsonValuesRootOp`, `wholeEntryKey` -- through
 * objects, records and arrays). Two schemas with the same key apply every
 * patch the same way, so content computed with one is content of the other.
 */
export function engineSchemaKey(schema: SerializedSchema | undefined): string {
  if (schema === undefined) return "";
  const found: string[] = [];
  const walk = (node: SerializedSchema | undefined, at: string): void => {
    if (node === undefined) return;
    if (node.type === "record" && node.jsonValues === true) {
      found.push(at);
      return;
    }
    if (node.type === "object") {
      for (const [key, item] of Object.entries(node.items)) {
        walk(item, `${at}/${JSON.stringify(key)}`);
      }
    } else if (node.type === "record" || node.type === "array") {
      walk(node.item, `${at}/*`);
    }
  };
  walk(schema, "");
  return found.join("\n");
}

// #region the view a field reads

/**
 * A module as a field reads it: its source with each `.jsonValues()` entry
 * whose content is known in place of its marker.
 *
 * The content is the engine's: an entry the chain wrote holds its content, an
 * entry it edited without the base loaded holds the edits until the base is
 * (`waiting`), and one it never touched is the base's. So this is where those
 * meet the base entries the Studio has read (`GET /json`), which are not part
 * of a version (the plan's phase 6 gives entries versions of their own).
 */
export type ModuleView = {
  readonly at: ModuleAt;
  /** What every read of the module walks. */
  readonly source: Json;
  /** The schema it was computed with, the module's `SchemaStore` object. */
  readonly schema: SerializedSchema | undefined;
  /** Entries the chain made unreadable: an edit that does not fit them. */
  readonly entryErrors: ReadonlyMap<
    string,
    { patchId: PatchId | undefined; message: string }
  >;
};

/**
 * What a marker left in a view at `key` waits for: the BASE entry to read
 * (`GET /json` without patches) -- its own key, or the one a rename moved it
 * from -- or `undefined` when no read can fill it (added content, an error).
 */
export function fetchKeyOf(view: ModuleView, key: string): string | undefined {
  const state = entryState(view.at.content, key);
  return state?.kind === "waiting" ? state.from : undefined;
}

/** Whether the entry at `key` is one the chain wrote or edited. */
export function chainTouches(view: ModuleView, key: string): boolean {
  return view.at.content.entries.has(key);
}

/**
 * Held edits resolved, kept by the NEWEST held op and the base content they
 * were resolved on: an entry typed into N times while its base is loaded is
 * resolved once per keystroke, by that keystroke's op, not N times over.
 */
export type ResolvedEntries = WeakMap<
  HeldOps,
  { base: Json; read: EntryContent }
>;

function resolveHeld(
  key: string,
  state: Extract<EntryState, { kind: "waiting" }>,
  base: Json,
  resolved: ResolvedEntries,
): EntryContent {
  const fresh: HeldOps[] = [];
  let node = state.ops;
  let start: EntryContent = { kind: "content", content: base };
  while (node !== null) {
    const hit = resolved.get(node);
    if (hit !== undefined && hit.base === base) {
      start = hit.read;
      break;
    }
    fresh.push(node);
    node = node.before;
  }
  if (start.kind !== "content" || fresh.length === 0) return start;
  let ops: HeldOps | null = null;
  for (let i = fresh.length - 1; i >= 0; i--) {
    const held = fresh[i];
    ops = { op: held.op, patchId: held.patchId, before: ops };
  }
  const startContent = start.content;
  const read = resolveEntry(
    key,
    { kind: "waiting", from: key, ops },
    () => startContent,
  );
  if (state.ops !== null) resolved.set(state.ops, { base, read });
  return read;
}

/**
 * The view of `at`, with these base entries read. Copy-on-write: the module's
 * own source when nothing is filled in (every module that is not a
 * `.jsonValues()` record), and otherwise one copy of its root.
 */
export function viewOf(
  at: ModuleAt,
  baseEntries: ReadonlyMap<string, Json> | undefined,
  schema: SerializedSchema | undefined,
  resolved: ResolvedEntries,
): ModuleView {
  const content = at.content;
  const source = content.source;
  const entryErrors = new Map<
    string,
    { patchId: PatchId | undefined; message: string }
  >();
  if (
    (content.entries.size === 0 &&
      (baseEntries === undefined || baseEntries.size === 0)) ||
    !isJsonObject(source)
  ) {
    return { at, source, schema, entryErrors };
  }
  let filled: Record<string, Json> | null = null;
  const fill = (key: string) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return;
    if (!Internal.isJson(source[key])) return;
    const state = entryState(content, key);
    if (state === undefined) return;
    let read: EntryContent;
    if (state.kind === "waiting") {
      const base = baseEntries?.get(state.from);
      if (base === undefined) return;
      read = resolveHeld(key, state, base, resolved);
    } else {
      read = resolveEntry(key, state, () => undefined);
    }
    if (read.kind === "error") {
      entryErrors.set(key, { patchId: read.patchId, message: read.message });
      return;
    }
    if (read.kind !== "content") return;
    filled ??= copyRoot(source);
    filled[key] = read.content;
  };
  for (const key of content.entries.keys()) fill(key);
  for (const key of baseEntries?.keys() ?? []) {
    if (!content.entries.has(key)) fill(key);
  }
  return { at, source: filled ?? source, schema, entryErrors };
}

/**
 * A shallow copy of a module's root, key by key: a record of many entries is
 * a large object in dictionary mode, which V8 copies this way at about twice
 * the speed of a spread (the engine's `copyObject` says the same).
 */
function copyRoot(source: {
  readonly [key: string]: Json;
}): Record<string, Json> {
  const copy: Record<string, Json> = {};
  for (const key of Object.keys(source)) {
    if (key === "__proto__") {
      Object.defineProperty(copy, key, {
        value: source[key],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    } else {
      copy[key] = source[key];
    }
  }
  return copy;
}

/** What a read at a module path finds in a view. */
export type Resolved =
  | { status: "found"; value: Json }
  | { status: "absent" }
  /**
   * The path continues INSIDE a `.jsonValues()` entry whose content is not
   * here. Its own status: the one outcome the store can do something about.
   */
  | { status: "needs-entry"; key: string };

/**
 * Walk `modulePath` through a view's source. A marker still standing at the
 * root is an entry whose content is not here: reading the entry path itself
 * answers with the marker (a read of the record's own value must not cause
 * N fetches); reading INTO it needs the entry. `.jsonValues()` is root-only,
 * so the entry key is always the first segment.
 */
export function resolveAt(source: Json, modulePath: string): Resolved {
  const parts = Internal.splitModulePath(modulePath as never);
  let current: Json = source;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (current === null || typeof current !== "object") {
      return { status: "absent" };
    }
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { status: "absent" };
      }
      current = current[index];
      continue;
    }
    if (!isJsonObject(current) || !(part in current)) {
      return { status: "absent" };
    }
    current = current[part];
    if (i === 0 && i < parts.length - 1 && Internal.isJson(current)) {
      return { status: "needs-entry", key: part };
    }
  }
  return { status: "found", value: current };
}

/**
 * A keyed JSON object, as opposed to an array or a primitive. A predicate
 * because `Array.isArray` narrows to `any[]` and does not remove `JsonArray`
 * (`readonly Json[]`) from the union.
 */
export function isJsonObject(
  value: Json,
): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
