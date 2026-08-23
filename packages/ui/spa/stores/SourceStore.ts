import {
  Internal,
  type Json,
  type JsonObject,
  type ModuleFilePath,
  type PatchId,
  type SourcePath,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import {
  applyPatch,
  deepClone,
  JSONOps,
  type JSONValue,
} from "@valbuild/core/patch";
import { StoreBus } from "./StoreBus";
import { touchesPath } from "./pathMatch";
import type {
  FieldEvent,
  PatchOrigin,
  PatchRecord,
  Revision,
  SourceRead,
  SystemEvent,
} from "./types";
import type { SchemaStore } from "./SchemaStore";
import type { PatchStore } from "./PatchStore";
import { noopActivity, type ActivitySink } from "./activity";

const ops = new JSONOps();

/**
 * Fetch one `.jsonValues()` entry's content (`GET /json` in the app).
 *
 * Injected like the other seams. Absent means this system cannot read INTO an
 * entry — the read reports an error rather than pretending the path is absent,
 * because "not there" and "nobody can fetch it" are different facts.
 */
export type FetchJsonEntry = (
  moduleFilePath: ModuleFilePath,
  key: string,
) => Promise<
  { status: "ok"; content: Json } | { status: "error"; message: string }
>;

/**
 * What `peek` says, without loading anything.
 *
 * `peek` exists because `get` has a SIDE EFFECT: it triggers an entry fetch. The
 * moment a read can cause work, anything that merely wants to look — a nav menu
 * counting entries, a badge, a progress indicator — becomes a fetch storm. So the
 * two are a pair: `get` asks for content and accepts the cost, `peek` observes
 * and cannot cost anything.
 */
export type SourcePeek =
  | { status: "ready"; revision: Revision }
  | { status: "absent"; revision: Revision }
  /** The module itself has not arrived. Nothing a read could do about it. */
  | { status: "module-loading" }
  /** Inside a `.jsonValues()` entry whose content has not been fetched. */
  | { status: "entry-missing"; key: string }
  /** Inside an entry whose fetch is in flight. */
  | { status: "entry-loading"; key: string };

type Resolved =
  | { status: "found"; value: Json }
  | { status: "absent" }
  /**
   * The path continues INSIDE a `.jsonValues()` entry whose content has not been
   * fetched. Deliberately its own status rather than folded into `absent` or
   * `error`: it is the one outcome the store can do something about, and the
   * only one where saying "not found" would be a lie that also stops the fetch
   * from ever being asked for.
   */
  | { status: "needs-entry"; key: string }
  | { status: "error"; message: string };

/**
 * Owns the patched source, and owns "who is listening where".
 *
 * Both in one store on purpose: because the same code applies the patch and
 * decides who to tell, the invariant *"if an event went out, the source behind
 * it is already applied"* holds by construction rather than by convention. A
 * field woken by an event can read immediately and cannot get a pre-patch
 * value.
 */
export class SourceStore {
  readonly events = new StoreBus<SystemEvent>();

  /**
   * Source with the applied chain folded in — the only source anyone reads.
   *
   * The base source is deliberately NOT kept alongside it. A rebase (HMR
   * swapping a module's source under existing patches, or `PUT /sources/~`)
   * needs it, and this prototype does not implement rebase — holding a base
   * that nothing ever reads would read as though it did.
   */
  private sources: Record<ModuleFilePath, Json> = {};

  /**
   * The source as authored, before any patch.
   *
   * Now genuinely kept, because `receive()` genuinely rebuilds from it. It
   * replaces an `appliedIds` array that was written twice and never read — the
   * state a rebuild needs, declared but unused, which is what made the "lands as
   * soon as the module arrives" comment below false.
   */
  private baseSources: Record<ModuleFilePath, Json> = {};

  /**
   * Every patch this store has seen for a module, in order, whether or not it
   * applied.
   *
   * Retained so that a module arriving late, or arriving AGAIN with new base
   * text (HMR, `PUT /sources/~`), can be rebuilt as base + chain. Without it a
   * patch announced before its module loaded was dropped and could never land,
   * and re-intake silently discarded the user's pending edits.
   */
  private chains = new Map<
    ModuleFilePath,
    { record: PatchRecord; origin: PatchOrigin; creatorFieldId?: string }[]
  >();

  /**
   * How far each module's source has moved. THE comparator for reads.
   *
   * Deliberately here rather than on the patch chain: it is bumped from the two
   * places that assign to `this.sources`, so every way source can change is
   * covered by construction. The chain version could not do that — it cannot see
   * a base-source replacement, so a commit, `PUT /sources/~`, HMR or a
   * `.jsonValues()` entry file change moved the value while it sat still.
   *
   * Adding a third way to change source (entry-content substitution) means adding
   * one `bump()` next to that assignment, not remembering to notify another store.
   */
  private revisions = new Map<ModuleFilePath, number>();

  /**
   * Loaded `.jsonValues()` entry content, keyed by module then entry key.
   *
   * A jsonValues module's own source carries only opaque `{_type:"json"}`
   * markers; the content lives in separate `*.val.json` files. Holding it HERE,
   * and substituting it on read, is the point: everything downstream — fields,
   * renders, validation, the search walk — then sees real content without any of
   * them knowing markers exist. The current engine keeps this beside source and
   * substitutes in `getPatchedSource`; this is that, moved to where source lives.
   */
  private jsonEntries = new Map<ModuleFilePath, Map<string, Json>>();
  /** In-flight entry fetches, so N readers of one entry cause ONE fetch. */
  private loadingEntries = new Map<string, Promise<void>>();
  /** Substituted source, cached against the revision it was computed at. */
  private substituted = new Map<ModuleFilePath, { n: number; source: Json }>();

  /**
   * One `EventTarget` per REGISTERED path, not per module.
   *
   * This is the registry that makes "no messages" a guarantee: a listener on a
   * path the patch did not touch is never invoked at all, so it costs nothing
   * and cannot be woken by a sibling's keystroke. The alternative — one target
   * per module with listeners filtering themselves — makes every mounted field
   * in a module run on every edit in that module.
   */
  private listenerTargets = new Map<
    SourcePath,
    Map<string, { target: EventTarget; count: number }>
  >();

  constructor(
    private readonly schemaStore: SchemaStore,
    private readonly activity: ActivitySink = noopActivity,
    private readonly fetchJsonEntry?: FetchJsonEntry,
  ) {}

  private bump(moduleFilePath: ModuleFilePath): void {
    this.revisions.set(
      moduleFilePath,
      (this.revisions.get(moduleFilePath) ?? 0) + 1,
    );
    this.substituted.delete(moduleFilePath);
  }

  /**
   * Deliver one entry's content. Bumps the module, because this changes what
   * reads return — the third way source can change, alongside a patch and a base
   * replacement, and the reason the revision lives in this store.
   */
  receiveJsonEntry(
    moduleFilePath: ModuleFilePath,
    key: string,
    content: Json,
  ): void {
    let byKey = this.jsonEntries.get(moduleFilePath);
    if (byKey === undefined) {
      byKey = new Map();
      this.jsonEntries.set(moduleFilePath, byKey);
    }
    byKey.set(key, content);
    this.activity.work("source:receive-json-entry", moduleFilePath);
    this.bump(moduleFilePath);
    this.events.emit({
      type: "source:patch-apply",
      success: [],
      failed: [],
      modules: [moduleFilePath],
    });
  }

  /**
   * Drop this module's loaded entry content.
   *
   * For `jsonEntriesSha` moving: an entry file changed on disk, and no other sha
   * can see it — the module's source is markers and the content sits behind a
   * thunk `JSON.stringify` drops. Coarse by necessity (the fingerprint cannot say
   * WHICH entry) and cheap because of it: dropping content causes no fetches,
   * only the next read of an entry does.
   */
  markJsonEntriesStale(moduleFilePath: ModuleFilePath): void {
    if (!this.jsonEntries.has(moduleFilePath)) return;
    this.jsonEntries.delete(moduleFilePath);
    this.bump(moduleFilePath);
  }

  /**
   * Does this module hold `.jsonValues()` markers with no content loaded?
   *
   * Asked by anything that WALKS source and must report its answer as partial:
   * the search index skips markers, and validation cannot claim a module is valid
   * whose content it never saw.
   */
  hasUnloadedEntries(moduleFilePath: ModuleFilePath): boolean {
    const source = this.sources[moduleFilePath];
    if (source === undefined || !isJsonObject(source)) {
      return false;
    }
    const loaded = this.jsonEntries.get(moduleFilePath);
    for (const [key, value] of Object.entries(source)) {
      if (!Internal.isJson(value)) continue;
      if (loaded?.has(key) !== true) return true;
    }
    return false;
  }

  /**
   * Status without side effects. See {@link SourcePeek}: `get` triggers a fetch,
   * so there has to be a way to look that cannot.
   */
  peek(path: SourcePath): SourcePeek {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    const source = this.sources[moduleFilePath];
    if (
      source === undefined ||
      this.schemaStore.get(moduleFilePath) === undefined
    ) {
      return { status: "module-loading" };
    }
    const resolved = resolveAtModulePath(
      source,
      modulePath,
      this.jsonEntries.get(moduleFilePath),
    );
    if (resolved.status === "needs-entry") {
      const inFlight = this.loadingEntries.has(
        entryKey(moduleFilePath, resolved.key),
      );
      return inFlight
        ? { status: "entry-loading", key: resolved.key }
        : { status: "entry-missing", key: resolved.key };
    }
    const revision = this.revisionOf(moduleFilePath);
    if (resolved.status === "found") return { status: "ready", revision };
    if (resolved.status === "absent") return { status: "absent", revision };
    return { status: "module-loading" };
  }

  private async loadEntry(
    moduleFilePath: ModuleFilePath,
    key: string,
  ): Promise<{ status: "ok" } | { status: "error"; message: string }> {
    if (this.fetchJsonEntry === undefined) {
      return {
        status: "error",
        message: `Cannot read inside '${key}' of ${moduleFilePath}: no jsonValues fetch is configured. Refusing rather than reporting the path absent.`,
      };
    }
    const cacheKey = entryKey(moduleFilePath, key);
    const inFlight = this.loadingEntries.get(cacheKey);
    if (inFlight !== undefined) {
      // N readers of one entry cause ONE fetch.
      this.activity.work("source:share-json-entry-load", moduleFilePath);
      await inFlight;
      return { status: "ok" };
    }
    let failure: string | undefined;
    const request = (async () => {
      this.activity.work("source:load-json-entry", moduleFilePath);
      const res = await this.fetchJsonEntry!(moduleFilePath, key);
      if (res.status === "error") {
        failure = res.message;
        return;
      }
      this.receiveJsonEntry(moduleFilePath, key, res.content);
    })().finally(() => {
      this.loadingEntries.delete(cacheKey);
    });
    this.loadingEntries.set(cacheKey, request);
    await request;
    // A definite failure, never a promise that never settles: a hanging read is
    // the one shape a field can neither render nor retry.
    return failure === undefined
      ? { status: "ok" }
      : { status: "error", message: failure };
  }

  /** Where this module's source has got to. */
  revisionOf(moduleFilePath: ModuleFilePath): Revision {
    return {
      module: moduleFilePath,
      n: this.revisions.get(moduleFilePath) ?? 0,
    };
  }

  /**
   * Reacts to both `patch:receive` (data arrived for an external patch) and
   * `patch:create` (a local edit). The two are handled identically except for
   * the origin reported to listeners, which is the only thing a field needs in
   * order to tell news from its own echo.
   */
  listenTo(patchStore: PatchStore): () => void {
    const offReceive = patchStore.events.on("patch:receive", (event) => {
      this.applyPatches(
        patchStore.recordsFor(event.patches),
        "external",
        // A patch fetched from the server was made elsewhere, so it is foreign
        // to every field here — there is nobody to leave asleep.
        () => undefined,
      );
    });
    const offCreate = patchStore.events.on("patch:create", (event) => {
      this.applyPatches(
        patchStore.recordsFor(event.patches),
        "internal",
        (id) => patchStore.creatorOf(id),
      );
    });
    return () => {
      offReceive();
      offCreate();
    };
  }

  receive(sources: Record<ModuleFilePath, Json>): void {
    // Cloned so the caller cannot keep a handle on what the store now owns and
    // mutate it from outside.
    for (const [moduleFilePath, source] of Object.entries(sources)) {
      this.activity.work("source:clone-module", moduleFilePath);
      const base = deepClone(source as JSONValue);
      this.baseSources[moduleFilePath as ModuleFilePath] = base;
      this.sources[moduleFilePath as ModuleFilePath] = deepClone(base);
      // The base was replaced, so every reader of this module is holding
      // something that may no longer be right — whatever the patch chain did.
      this.bump(moduleFilePath as ModuleFilePath);
    }
    this.events.emit({
      type: "source:init",
      sources: Object.keys(sources) as ModuleFilePath[],
    });
    // The rebase. Base source has just been replaced under whatever patches
    // already exist, so the chain has to be re-applied on top of it or the new
    // base silently wins and the user's pending edits vanish.
    //
    // Emitted as its own `source:patch-apply` after `source:init` rather than
    // being folded into it: consumers that invalidate on init have already been
    // told the module changed, and the apply is what tells the patch store which
    // ids landed — which is how the head settles for a patch that arrived
    // before its module.
    for (const moduleFilePath of Object.keys(sources) as ModuleFilePath[]) {
      const chain = this.chains.get(moduleFilePath);
      if (chain === undefined || chain.length === 0) continue;
      this.applyEntries(chain);
    }
  }

  /**
   * Read one path, quoting the head you believe is current.
   *
   * The handshake is what makes the read safe to do asynchronously: an answer
   * computed against a head that has since moved comes back as
   * `resolved-out-of-date` carrying the new head, so a slow reply can never
   * overwrite a newer value. Without it, a read racing a patch would silently
   * win with stale data.
   */
  async get(path: SourcePath, revision: Revision | null): Promise<SourceRead> {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    const current = this.revisionOf(moduleFilePath);
    const source = this.sources[moduleFilePath];
    // The cheap answer: what you hold is still right, so nothing is marshalled.
    // This is the only reason to pass a head — once source is across a worker
    // seam it is the difference between a read costing a clone and costing
    // nothing. It is checked before `module-loading` only for a loaded module,
    // so an unloaded one still says so rather than claiming to be unchanged.
    if (
      revision !== null &&
      // Same module AND same count. The module check means a revision for some
      // other module can never produce a false `unchanged` — the one way this
      // fast path could silently mislead.
      revision.module === moduleFilePath &&
      revision.n === current.n &&
      source !== undefined &&
      this.schemaStore.get(moduleFilePath) !== undefined
    ) {
      return { status: "unchanged", revision: current };
    }
    // `absent` is only ever returned when we know enough to say so. Without
    // the schema we do not: a module whose schema has not loaded may resolve
    // this path once it has. Collapsing the two is the bug this split exists
    // to prevent.
    if (
      source === undefined ||
      this.schemaStore.get(moduleFilePath) === undefined
    ) {
      return { status: "module-loading" };
    }
    this.activity.work("source:read-path", path);
    let resolved = resolveAtModulePath(
      source,
      modulePath,
      this.jsonEntries.get(moduleFilePath),
    );
    if (resolved.status === "needs-entry") {
      // The READ is the demand signal for entry content, and it waits for it.
      //
      // Not a `module-loading` reply the caller has to re-issue: nothing tells a
      // caller when to retry, so a field would either poll or hang. `get` is
      // already async, so "loading" is a state the CALL is in — the awaited
      // promise is the loading state, and `peek` is there for anything that
      // wants to observe it without paying for it.
      const load = await this.loadEntry(moduleFilePath, resolved.key);
      if (load.status === "error") {
        return { status: "error", message: load.message };
      }
      // Re-resolved from the store rather than from `source`: the load bumped
      // the revision and the substitution cache, so `source` is a stale handle.
      const loaded = this.sources[moduleFilePath];
      if (loaded === undefined) {
        return { status: "module-loading" };
      }
      resolved = resolveAtModulePath(
        loaded,
        modulePath,
        this.jsonEntries.get(moduleFilePath),
      );
      if (resolved.status === "needs-entry") {
        // At most ONE load per read, by construction rather than by a depth
        // counter: `.jsonValues()` is root-only, so one entry is all a path can
        // need. Reaching here means the fetch reported success and delivered
        // nothing, which is a bug in the seam — reported, not retried, because a
        // retry loop here is an unbounded fetch storm.
        return {
          status: "error",
          message: `Entry '${resolved.key}' of ${moduleFilePath} was loaded but its content is still missing.`,
        };
      }
    }
    // Read AFTER any load, because a load moves the revision. Handing back the
    // pre-load revision would make the very next read of this path report
    // `unchanged` against source that had in fact changed underneath it.
    const resolvedAt = this.revisionOf(moduleFilePath);
    if (resolved.status === "absent") {
      return { status: "absent", revision: resolvedAt };
    }
    if (resolved.status === "error") {
      return { status: "error", message: resolved.message };
    }
    // The head travels with the value. A reader with two reads in flight keeps
    // the newest head it has accepted and drops the rest — see `isNewerHead`.
    return {
      status: "resolved-head",
      data: resolved.value,
      revision: resolvedAt,
    };
  }

  /**
   * Is this head still the current one?
   *
   * The same question `get` answers, without the value. For a slow watchdog:
   * monotonic acceptance handles out-of-order replies, but nothing handles a
   * notification that was never delivered, so something has to be able to ask
   * cheaply. Async like every other field-facing read, so moving source behind a
   * worker does not rewrite the caller.
   */
  async isCurrent(revision: Revision): Promise<boolean> {
    return revision.n === this.revisionOf(revision.module).n;
  }

  /**
   * The patched source for one module, for other stores in this realm.
   *
   * Deliberately NOT cloned: cloning per caller is exactly the cost this whole
   * rewrite exists to remove. In-realm callers (search, validation, patch sets)
   * only read, and they are all in this file's tree — the boundary that has to
   * be defended is the one to the main thread, and that is `get()`.
   */
  moduleSource(moduleFilePath: ModuleFilePath): Json | undefined {
    const source = this.sources[moduleFilePath];
    if (source === undefined) return undefined;
    const entries = this.jsonEntries.get(moduleFilePath);
    if (entries === undefined || entries.size === 0) return source;
    // Cached against the revision it was computed at, because every in-realm
    // consumer of a `.jsonValues()` module asks for the same substituted source:
    // the search walk, schema validation and the custom-validate walk would
    // otherwise each rebuild it, per module, per pass.
    const n = this.revisions.get(moduleFilePath) ?? 0;
    const cached = this.substituted.get(moduleFilePath);
    if (cached !== undefined && cached.n === n) {
      return cached.source;
    }
    this.activity.work("source:substitute-json-entries", moduleFilePath);
    const substituted = substituteJsonEntries(source, entries);
    this.substituted.set(moduleFilePath, { n, source: substituted });
    return substituted;
  }

  loadedModules(): ModuleFilePath[] {
    return Object.keys(this.sources) as ModuleFilePath[];
  }

  /**
   * Every path currently registered in this module. THE demand signal, read
   * rather than pushed.
   *
   * The render store needs it to scope a render to what is actually on screen,
   * and reading it means the scope is DERIVED from live state rather than
   * accumulated: it shrinks when a field unmounts, so a row scrolled past stops
   * being paid for. An accumulated scope could only grow, which over a session
   * converges back on rendering the whole module.
   */
  listenedPaths(moduleFilePath: ModuleFilePath): SourcePath[] {
    const paths: SourcePath[] = [];
    for (const path of this.listenerTargets.keys()) {
      const [candidate] = Internal.splitModuleFilePathAndModulePath(path);
      if (candidate === moduleFilePath) {
        paths.push(path);
      }
    }
    return paths;
  }

  /**
   * Register interest in one path. The returned function unregisters, and the
   * path's target is dropped once nobody is left on it — an unbounded registry
   * would make the intersection on every patch slower over a session.
   */
  addListener(
    path: SourcePath,
    /**
     * The field INSTANCE registering. Two instances can show one path — a studio
     * field and an inline overlay — and what is internal to one is foreign to the
     * other, so suppression has to be per instance. One `EventTarget` per
     * (path, fieldId) is what makes "wake everyone except the one that caused
     * it" expressible at all: a single target per path could only be dispatched
     * to wholesale.
     */
    fieldId: string,
    listener: (event: FieldEvent) => void,
  ): () => void {
    let byField = this.listenerTargets.get(path);
    if (!byField) {
      byField = new Map();
      this.listenerTargets.set(path, byField);
    }
    let entry = byField.get(fieldId);
    if (!entry) {
      entry = { target: new EventTarget(), count: 0 };
      byField.set(fieldId, entry);
    }
    const registered = entry;
    const fields = byField;
    const handler = (ev: Event) => {
      listener((ev as CustomEvent<FieldEvent>).detail);
    };
    registered.target.addEventListener(FIELD_EVENT, handler);
    registered.count++;
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    // Announced so demand-driven consumers can act on it. The render store is
    // the reason this exists: a field mounting is what asks for a render.
    this.events.emit({ type: "source:listen", path, moduleFilePath });
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      registered.target.removeEventListener(FIELD_EVENT, handler);
      registered.count--;
      this.events.emit({ type: "source:unlisten", path, moduleFilePath });
      // `EventTarget` exposes no listener count, so the store keeps its own.
      // Dropping empty entries matters: the intersection below walks every
      // registered path on every patch, so a registry that only ever grows
      // would make a long session progressively slower.
      if (registered.count <= 0 && fields.get(fieldId) === registered) {
        fields.delete(fieldId);
        if (fields.size === 0 && this.listenerTargets.get(path) === fields) {
          this.listenerTargets.delete(path);
        }
      }
    };
  }

  /**
   * Record these patches in their modules' chains, then apply them.
   *
   * Recording happens BEFORE the loaded check, which is the whole fix for a
   * patch that arrives ahead of its module: it is remembered now and applied by
   * `receive()` later, rather than dropped.
   */
  private applyPatches(
    records: PatchRecord[],
    origin: PatchOrigin,
    creatorOf: (patchId: PatchId) => string | undefined,
  ): void {
    if (records.length === 0) return;
    const entries = records.map((record) => ({
      record,
      origin,
      creatorFieldId: creatorOf(record.patchId),
    }));
    for (const entry of entries) {
      const moduleFilePath = entry.record.moduleFilePath;
      const chain = this.chains.get(moduleFilePath);
      if (chain === undefined) {
        this.chains.set(moduleFilePath, [entry]);
      } else {
        chain.push(entry);
      }
    }
    this.applyEntries(entries);
  }

  /**
   * Apply already-recorded entries. Used both for new patches and for the
   * replay in `receive()`, so one code path decides what "applied" means.
   */
  private applyEntries(
    entries: {
      record: PatchRecord;
      origin: PatchOrigin;
      creatorFieldId?: string;
    }[],
  ): void {
    if (entries.length === 0) return;
    const success: PatchId[] = [];
    const failed: { patchId: PatchId; message: string }[] = [];
    const touched: SourcePath[] = [];
    const changedModules = new Set<ModuleFilePath>();

    // Grouped by (origin, creator): a replay can mix a local edit and a foreign
    // one, and the creator decides which single listener stays asleep.
    const wokenBy: {
      origin: PatchOrigin;
      creatorFieldId?: string;
      paths: SourcePath[];
    }[] = [];
    for (const { record, origin, creatorFieldId } of entries) {
      const current = this.sources[record.moduleFilePath];
      if (current === undefined) {
        // The module is not loaded, so there is nothing to apply the patch to
        // yet. Not a failure: `receive()` rebuilds from base + chain, so this
        // patch lands as soon as the module arrives.
        this.activity.work("source:skip-unloaded", record.moduleFilePath);
        continue;
      }
      // `file` ops carry binary data, not a document mutation — the JSON patch
      // ops cannot express them and `applyPatch` rejects them outright.
      const patchableOps = record.patch.filter((op) => op.op !== "file");
      if (patchableOps.length === 0) {
        success.push(record.patchId);
        continue;
      }
      // Two units of work, counted separately on purpose: the clone is
      // proportional to the MODULE and the apply is proportional to the PATCH,
      // so a redundant clone and a redundant apply are different bugs.
      this.activity.work("source:clone-module", record.moduleFilePath);
      this.activity.work("source:apply-patch", record.patchId);
      const res = applyPatch(
        deepClone(current as JSONValue),
        ops,
        patchableOps,
      );
      if (result.isOk(res)) {
        this.sources[record.moduleFilePath] = res.value;
        this.bump(record.moduleFilePath);
        success.push(record.patchId);
        changedModules.add(record.moduleFilePath);
        const paths = touchedSourcePaths(record);
        touched.push(...paths);
        const existing = wokenBy.find(
          (group) =>
            group.origin === origin && group.creatorFieldId === creatorFieldId,
        );
        if (existing === undefined) {
          wokenBy.push({ origin, creatorFieldId, paths: [...paths] });
        } else {
          existing.paths.push(...paths);
        }
      } else {
        failed.push({ patchId: record.patchId, message: res.error.message });
      }
    }

    // An apply in which nothing applied is not news, and every consumer would
    // otherwise have to defend against an event whose three payloads are all
    // empty. Reached whenever every record targeted a module that is not
    // loaded — which is now a deferral rather than a loss.
    if (success.length === 0 && failed.length === 0) {
      return;
    }

    // Emitted BEFORE the field events, and the ordering is load-bearing:
    // dispatch is synchronous, so the patch store has folded this result into
    // its head by the time we read it below. Field events therefore carry the
    // head that already includes the patch that caused them.
    this.events.emit({
      type: "source:patch-apply",
      success,
      failed,
      modules: [...changedModules],
    });

    if (touched.length === 0) return;
    // The scan is O(registered paths); the wakes are what the design promises
    // is O(fields actually affected). Counting both is how a test tells the
    // difference between "we looked at everything" and "we woke everything".
    this.activity.work(
      "source:scan-listeners",
      undefined,
      this.listenerTargets.size,
    );
    for (const [path, byField] of this.listenerTargets) {
      for (const group of wokenBy) {
        if (!touchesPath(group.paths, path)) continue;
        // Per matched path, not per registered path: only paths that are
        // actually being woken pay for the split.
        const [wokenModule] = Internal.splitModuleFilePathAndModulePath(path);
        const revision = this.revisionOf(wokenModule);
        for (const [fieldId, entry] of byField) {
          // The one listener that caused this stays asleep. Everyone else on the
          // path is woken — which is what makes a studio field and an inline
          // overlay on one path both update, while the instance being typed into
          // is not interrupted by its own keystroke.
          if (fieldId === group.creatorFieldId) continue;
          this.activity.work("source:wake-listener", path);
          const detail: FieldEvent = {
            type: `${group.origin}-patch`,
            path,
            revision,
          };
          entry.target.dispatchEvent(new CustomEvent(FIELD_EVENT, { detail }));
        }
        break;
      }
    }
  }
}

const FIELD_EVENT = "val:field-changed";

/**
 * Which source paths a patch may have changed.
 *
 * Op paths are patch paths (`["field"]`); listeners register source paths
 * (`/test.val.ts?"field"`), so each op path is converted and qualified with the
 * module. `move`/`copy` change two places, so both ends are reported.
 */
function touchedSourcePaths(record: PatchRecord): SourcePath[] {
  const paths: SourcePath[] = [];
  const add = (patchPath: string[]) => {
    paths.push(
      Internal.joinModuleFilePathAndModulePath(
        record.moduleFilePath,
        Internal.patchPathToModulePath(patchPath),
      ),
    );
  };
  for (const op of record.patch) {
    if (op.op === "file") continue;
    add(op.path);
    if (op.op === "move" || op.op === "copy") {
      add(op.from);
      addShiftedContainer(op.from);
    }
    // An insert or a removal at an array index shifts EVERY later index, so the
    // value at each of them changed without any of them appearing in an op
    // path. Reporting the container covers them, because `touchesPath` matches
    // an ancestor of a registered path as well as a descendant.
    //
    // Only for the ops that shift: a `replace` at an index changes that index
    // alone, and reporting its container would wake every sibling in the array
    // on every keystroke — the module-granular fan-out this design replaces.
    if (op.op === "add" || op.op === "remove" || op.op === "move") {
      addShiftedContainer(op.path);
    }
  }
  return paths;

  /**
   * Report the parent of an op path when the last segment is an array index.
   *
   * Whether the container really is an array is not knowable from the op alone,
   * so a numeric key on an object also reports its parent. That is a false
   * positive costing one extra wake, against a false negative that leaves a
   * field displaying a value the store no longer holds.
   */
  function addShiftedContainer(patchPath: string[]): void {
    if (patchPath.length === 0) return;
    const last = patchPath[patchPath.length - 1];
    if (!Number.isInteger(Number(last))) return;
    add(patchPath.slice(0, -1));
  }
}

function resolveAtModulePath(
  source: Json,
  modulePath: string,
  entries: Map<string, Json> | undefined,
): Resolved {
  const parts = Internal.splitModulePath(modulePath as never);
  // Substituted up front rather than per step, so a path that continues into an
  // entry walks real content with no further marker handling below.
  let current: Json = substituteJsonEntries(source, entries);
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
    if (!(part in current)) {
      return { status: "absent" };
    }
    current = (current as Record<string, Json>)[part];
    // A marker that survived substitution is content nobody has fetched.
    //
    // Only when the caller wants to go DEEPER: reading the entry path itself is
    // answered with the marker, because the marker is what the source holds
    // there, and a read of the record's own value must not trigger N fetches.
    //
    // `.jsonValues()` is root-only, so the entry key is always the first segment
    // — which is why `i === 0` is a condition and not an assertion: a marker
    // found deeper is not an entry and this function cannot name its key.
    if (i === 0 && i < parts.length - 1 && Internal.isJson(current)) {
      return { status: "needs-entry", key: part };
    }
  }
  return { status: "found", value: current };
}

/**
 * `source` with every loaded `.jsonValues()` entry's content in place of its
 * marker.
 *
 * Root-only and marker-guarded, matching the schema: content is only ever
 * substituted where the source actually holds a marker, so a stale cache entry
 * for a key that has since become a normal value cannot resurrect it.
 *
 * Copy-on-write — the input is returned untouched when there is nothing to
 * substitute, which is every module in a project that uses no `.jsonValues()`.
 */
function substituteJsonEntries(
  source: Json,
  entries: Map<string, Json> | undefined,
): Json {
  if (entries === undefined || entries.size === 0) return source;
  if (!isJsonObject(source)) return source;
  let copy: Record<string, Json> | null = null;
  for (const [key, content] of entries) {
    if (!Internal.isJson(source[key])) continue;
    if (copy === null) {
      copy = { ...source };
    }
    copy[key] = content;
  }
  return copy ?? source;
}

/**
 * A keyed JSON object, as opposed to an array or a primitive.
 *
 * A predicate rather than the three checks inline, because `Array.isArray`
 * narrows to `any[]` and so does NOT remove `JsonArray` (`readonly Json[]`) from
 * the union — the checks read as though they narrow and then do not. Mirrors
 * `isRecordSource` in `validation/customValidate.ts`.
 */
function isJsonObject(value: Json): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cache key for one entry of one module. `\0` cannot occur in either half. */
function entryKey(moduleFilePath: ModuleFilePath, key: string): string {
  return `${moduleFilePath}\0${key}`;
}
