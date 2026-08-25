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
import { touchesPath, type ChangedPath } from "./pathMatch";
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
 *
 * ## `ready` carries the value, and that settles an open question
 *
 * `openquestions.md` item 1 asked whether the host realm should get a synchronous
 * read. The async `get` makes a mounting field render TWICE — once with nothing,
 * then again a microtask later when the value lands — which is the one place the
 * browser measurement showed the stores doing more work than the engine (32
 * component renders on mount against 16). The question priced the fix at "a
 * second read API and a rule about which one a field may use".
 *
 * Neither is needed, because both already exist. This IS the synchronous read:
 * `peek` already resolves the path all the way to the value and then discards it,
 * so carrying it costs nothing — source is in the host realm precisely so a read
 * needs no clone. And the rule is the one `peek` was created with: **`peek` to
 * render, `get` to demand.** A field's `getSnapshot` peeks, which is synchronous
 * and therefore renders once; a field that peeks and is told `entry-missing` calls
 * `get`, which fetches.
 *
 * What is NOT offered is an `unchanged` fast path. Passing the revision you hold
 * buys nothing here: the point of `unchanged` is to avoid marshalling a value
 * across a seam, and nothing is marshalled in-realm. Adding it would be a second
 * way to ask one question, which is exactly the cost the open question was worried
 * about.
 *
 * `get` stays async regardless. Not for a future worker — source is host-realm by
 * design — but because a `.jsonValues()` entry fetch is a real network round trip
 * and no signature can pretend otherwise.
 */
export type SourcePeek =
  | {
      status: "ready";
      revision: Revision;
      /**
       * The value at the path. A reference into the store's own source, not a
       * copy: cloning here would reintroduce the per-read cost the host realm
       * exists to avoid. Callers must not mutate it — the same contract every
       * other in-realm read in this system has.
       */
      data: Json;
    }
  | { status: "absent"; revision: Revision }
  /** The module itself has not arrived. Nothing a read could do about it. */
  | { status: "module-loading" }
  /** Inside a `.jsonValues()` entry whose content has not been fetched. */
  | { status: "entry-missing"; key: string }
  /** Inside an entry whose fetch is in flight. */
  | { status: "entry-loading"; key: string }
  /**
   * Inside an entry whose last fetch FAILED.
   *
   * Distinct from `entry-missing` because the two demand opposite things of a
   * caller: missing means "ask for it", failed means "stop asking and say so".
   * Collapsing them is how a failed entry becomes a spinner that never resolves —
   * the caller retries, the retry fails, and nothing ever changes.
   */
  | { status: "entry-failed"; key: string; message: string };

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
/** The shape {@link SourceStore.entriesStatus} answers with. */
type EntriesStatus = {
  status: "complete" | "incomplete" | "error";
  errors: { moduleFilePath: ModuleFilePath; key: string; message: string }[];
};

/**
 * Are two entry statuses the same answer?
 *
 * Compared field by field rather than by `JSON.stringify`: the error list is
 * small and ordered by the walk, so this is both cheaper and honest about what
 * "the same" means here.
 */
function sameEntriesStatus(a: EntriesStatus, b: EntriesStatus): boolean {
  if (a.status !== b.status || a.errors.length !== b.errors.length) {
    return false;
  }
  for (let index = 0; index < a.errors.length; index++) {
    const left = a.errors[index];
    const right = b.errors[index];
    if (
      left.moduleFilePath !== right.moduleFilePath ||
      left.key !== right.key ||
      left.message !== right.message
    ) {
      return false;
    }
  }
  return true;
}

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
   * The last object {@link peek} returned per path, so an unchanged answer is
   * `===` on the next call.
   *
   * Grows with the number of DISTINCT paths anything has peeked, which is bounded
   * by the project: a path that is peeked once and never again holds one small
   * object. Not worth evicting, and evicting on unlisten would be wrong — plenty
   * of callers peek without listening.
   */
  private peeked = new Map<SourcePath, SourcePeek>();
  /** The same, for {@link peekBase}. Separate map: different question, same path. */
  private peekedBase = new Map<SourcePath, SourcePeek>();

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
  /**
   * Entries whose last fetch FAILED, and why.
   *
   * Kept because `peek` has to be able to say so. Without it a hook that peeks
   * cannot tell "not fetched yet" from "fetch failed" — both look like
   * `entry-missing` — so a failed entry renders a spinner forever while the
   * effect that would retry sees nothing new to do. The failure was already
   * known here and was being returned to one caller and then dropped.
   *
   * Cleared on a successful fetch and on a fresh attempt, so a retry that works
   * stops reporting the old failure.
   */
  private entryFailures = new Map<string, string>();
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

  /**
   * The registered paths, grouped by module.
   *
   * Redundant with `listenerTargets` on purpose, and the redundancy is paid for:
   * `listenedPaths(module)` is asked once per render refresh, and a browser
   * measurement showed the obvious implementation — walk every registered path
   * and split each one — making a mount O(fields x modules). Mounting 260 fields
   * across 141 modules cost 3.3ms in registry scanning alone, against 0.2ms for
   * the engine this replaces. Per-module makes it O(paths in that module).
   */
  private listenersByModule = new Map<ModuleFilePath, Set<SourcePath>>();

  constructor(
    private readonly schemaStore: SchemaStore,
    private readonly activity: ActivitySink = noopActivity,
    private readonly fetchJsonEntry?: FetchJsonEntry,
  ) {}

  /**
   * A counter over EVERY module, moved by every `bump`.
   *
   * For a whole-project reader — "all sources", the nav tree, search — whose
   * snapshot has to be a stable value that changes when anything could have.
   * A number, so it is stable by construction; the same reasoning as
   * `SchemaStore.version`.
   */
  private globalRevision = 0;

  /**
   * Modules whose change is computed but not yet announced. See {@link batched}.
   *
   * Only ever non-empty inside a batch: the revisions have already moved, so a
   * read during one is correct — what is deferred is the telling, not the doing.
   */
  private deferredAnnouncements = new Set<ModuleFilePath>();
  private batchDepth = 0;

  private bump(moduleFilePath: ModuleFilePath): void {
    this.revisions.set(
      moduleFilePath,
      (this.revisions.get(moduleFilePath) ?? 0) + 1,
    );
    this.globalRevision++;
    this.substituted.delete(moduleFilePath);
    this.allSourcesAt = null;
    if (this.batchDepth > 0) {
      this.deferredAnnouncements.add(moduleFilePath);
      return;
    }
    // The one place a revision moves is the one place this is announced. See
    // `source:change` in `types.ts` for why it is not the union of the five
    // specific events.
    this.events.emit({ type: "source:change", moduleFilePath });
  }

  /**
   * Run `fn`, announcing the modules it changed ONCE at the end instead of once
   * per change.
   *
   * For an operation that is one thing to its caller but many writes underneath.
   * Loading a `.jsonValues()` record's entries is the case that forced it: each
   * entry is its own request, each arrival bumped the module, and every bump woke
   * every whole-project subscriber in the app. A 121-entry record therefore
   * re-rendered the open module 121 times in a burst — doubled by StrictMode —
   * and the ref churn under it nested deep enough to trip React's update-depth
   * limit. The route died with "Maximum update depth exceeded" from inside a
   * Radix ref callback, which names nothing about entries; only counting the
   * renders found it.
   *
   * Deferring the ANNOUNCEMENT and not the write is what makes this safe: the
   * revisions, the `substituted` cache and `allSourcesAt` are all updated as each
   * entry lands, so anything that reads mid-batch sees current data. Only the
   * events wait.
   *
   * Flushed in a `finally` before the returned promise settles, so a caller that
   * awaits this and then asserts on events sees them — deliberately not a
   * `setTimeout`, which would emit after the await and make that racy.
   *
   * The cost: a progress indicator fed by `source:change` advances once per
   * batch rather than per entry. Worth it against 121 whole-project re-renders,
   * and a dedicated progress event is the fix if the bar needs to animate.
   */
  private async batched<T>(fn: () => Promise<T>): Promise<T> {
    this.batchDepth++;
    try {
      return await fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.deferredAnnouncements.size > 0) {
        const modules = [...this.deferredAnnouncements];
        this.deferredAnnouncements.clear();
        for (const moduleFilePath of modules) {
          this.events.emit({ type: "source:change", moduleFilePath });
        }
        this.events.emit({
          type: "source:patch-apply",
          success: [],
          failed: [],
          modules,
        });
      }
    }
  }

  /**
   * Where `globalRevision` stood when {@link allSources} was last built, or
   * `null` if it must be rebuilt. Cleared by `bump`, which is what makes the
   * memo safe: it is invalidated from the same single place that invalidates
   * everything else about a module's source.
   */
  private allSourcesAt: {
    n: number;
    sources: Record<ModuleFilePath, Json>;
  } | null = null;

  /** Moved by every source change, anywhere. See {@link globalRevision}. */
  sourcesVersion(): number {
    return this.globalRevision;
  }

  /**
   * Every loaded module's source, as a read would see it.
   *
   * Substituted, so `.jsonValues()` content that has been fetched is present —
   * a whole-project consumer must see the same values a field does, or the nav
   * tree and the field disagree about what exists.
   *
   * Reference-stable across an unchanged `globalRevision`, because this is a
   * `useSyncExternalStore` snapshot too. Memoised rather than recomputed-and-
   * compared, unlike `peek`: this walk is O(project), and comparing two
   * whole-project records is no cheaper than building one.
   *
   * The engine's `getAllSourcesSnapshot` deep-cloned every module on every
   * rebuild. This does not: the store owns these objects and nothing downstream
   * writes to them, so a clone bought only the cost of copying the project.
   */
  allSources(): Record<ModuleFilePath, Json> {
    const cached = this.allSourcesAt;
    if (cached !== null && cached.n === this.globalRevision) {
      return cached.sources;
    }
    const sources: Record<ModuleFilePath, Json> = {};
    for (const moduleFilePath of Object.keys(
      this.sources,
    ) as ModuleFilePath[]) {
      const source = this.moduleSource(moduleFilePath);
      if (source !== undefined) {
        sources[moduleFilePath] = source;
      }
    }
    this.allSourcesAt = { n: this.globalRevision, sources };
    return sources;
  }

  /**
   * `.jsonValues()` entries across the whole project: how many there are, how
   * many are here, how many failed.
   *
   * Summed from {@link entriesProgress}, so a progress indicator cannot
   * disagree with what a read of any single module would find.
   */
  allEntriesProgress(): { total: number; loaded: number; failed: number } {
    let total = 0;
    let loaded = 0;
    let failed = 0;
    for (const moduleFilePath of Object.keys(
      this.sources,
    ) as ModuleFilePath[]) {
      const at = this.entriesProgress(moduleFilePath);
      total += at.total;
      loaded += at.loaded;
      failed += at.failed;
    }
    const next = { total, loaded, failed };
    // Stable for the same reason as `entriesStatus` above: a progress hook reads
    // this on every render.
    const previous = this.allEntriesProgressCache;
    if (
      previous !== null &&
      previous.total === next.total &&
      previous.loaded === next.loaded &&
      previous.failed === next.failed
    ) {
      return previous;
    }
    this.allEntriesProgressCache = next;
    return next;
  }

  private allEntriesProgressCache: {
    total: number;
    loaded: number;
    failed: number;
  } | null = null;

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
    if (this.batchDepth > 0) {
      // `batched` emits one of these for the whole batch. Emitting here as well
      // would invalidate every render and every validation in the module once
      // per entry, which is the storm this exists to stop.
      return;
    }
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
   *
   * It COULD be per entry, and cheaply: the key↔file mapping is CANONICAL —
   * `/content/kb.val.ts` + key `kb-000` is `/content/kb/kb-000.val.json`, per
   * `getNewJsonEntryPaths`. So a changed file localises to exactly one key by
   * derivation, no server metadata needed: 1 refetch instead of 120.
   *
   * Blocked on enforcement, not on the derivation. Nothing validates that an
   * entry's import target IS the canonical path — `examples/next` itself points
   * key `kb-000` at `entry-000.val.json` and passes — so the derivation cannot be
   * trusted yet. See `openquestions.md` item 9b.
   */
  markJsonEntriesStale(moduleFilePath: ModuleFilePath): void {
    if (!this.jsonEntries.has(moduleFilePath)) return;
    this.jsonEntries.delete(moduleFilePath);
    this.bump(moduleFilePath);
  }

  /**
   * Load these `.jsonValues()` entries, and only the ones not already here.
   *
   * For a caller that knows WHICH entries it is about to need — a virtualized
   * record list scrolling a window of rows into view. Reading each one through
   * `get` would work, and is what a field does; this exists because the list
   * knows the whole window at once and issuing them together lets
   * {@link loadEntry} share the in-flight fetches rather than serialise them.
   *
   * Silent on failure by design: a failed entry is recorded in `entryFailures`
   * and reported by `peek` as `entry-failed`, which is where a row shows it. A
   * rejected promise here would make a prefetch of twenty rows fail because one
   * of them did.
   */
  async loadEntries(
    moduleFilePath: ModuleFilePath,
    keys: readonly string[],
  ): Promise<void> {
    const here = this.jsonEntries.get(moduleFilePath);
    const wanted = keys.filter((key) => here?.has(key) !== true);
    if (wanted.length === 0) return;
    /**
     * Coalesced per module per tick, then announced once.
     *
     * The engine did this too — its call site in `VirtualizedRecordList` said
     * "coalesced by the engine into one request per module per tick, so a fast
     * scroll that crosses several windows does not fan out" — and porting the
     * call to the store dropped it. That turned out to be load-bearing for more
     * than request count: a virtualized `.jsonValues()` record asks for the
     * window it is showing, and every arrival re-renders those rows, which moves
     * the window, which asks again. One announcement per tick is what lets that
     * settle; per call it walked the whole record and blew React's update depth.
     */
    let pending = this.pendingEntryLoads.get(moduleFilePath);
    if (pending === undefined) {
      const keysWanted = new Set<string>();
      const request = (async () => {
        // One turn for every caller in this tick to join, then one fetch and one
        // announcement for all of them.
        await Promise.resolve();
        this.pendingEntryLoads.delete(moduleFilePath);
        await this.batched(() =>
          Promise.all(
            [...keysWanted].map((key) => this.loadEntry(moduleFilePath, key)),
          ),
        );
      })();
      pending = { keys: keysWanted, request };
      this.pendingEntryLoads.set(moduleFilePath, pending);
    }
    for (const key of wanted) {
      pending.keys.add(key);
    }
    await pending.request;
  }

  /** In-flight coalesced entry loads, per module. See {@link loadEntries}. */
  private pendingEntryLoads = new Map<
    ModuleFilePath,
    { keys: Set<string>; request: Promise<void> }
  >();

  /**
   * Every `.jsonValues()` entry this module has, loaded.
   *
   * The deliberate exception to demand-driven reading, and the callers are the
   * ones that genuinely need the whole module: search over a project, a
   * validation pass, a compare view that has to diff every entry. All of them
   * would otherwise walk the module and find markers, and report a partial
   * answer as if it were complete.
   */
  async loadAllEntries(moduleFilePath: ModuleFilePath): Promise<void> {
    const source = this.sources[moduleFilePath];
    if (source === undefined || !isJsonObject(source)) return;
    const keys: string[] = [];
    for (const [key, value] of Object.entries(source)) {
      if (Internal.isJson(value)) keys.push(key);
    }
    await this.loadEntries(moduleFilePath, keys);
  }

  /**
   * Are every one of these modules' `.jsonValues()` entries here?
   *
   * For a guard that must not act on a partial view of the project: a reference
   * scan that reports "no referrers" because it never saw half the content is
   * worse than one that says it is still loading.
   *
   * Three answers, and the middle one matters: `incomplete` means keep waiting,
   * `error` names the entries that will never arrive without a retry. A caller
   * that could not tell them apart would either wait forever or act on a gap.
   *
   * Computed from source and the loaded map on every call rather than tracked,
   * for the same reason {@link entriesProgress} is: these numbers come from
   * where a read gets its answer, so "complete" cannot be true while a read
   * would still find a marker. The engine kept a stale-entry set and an
   * in-flight set alongside the content and had to consult all three in the
   * right order; here a re-fetched entry is simply deleted, so it reads as not
   * loaded, which it is.
   */
  entriesStatus(moduleFilePaths: readonly ModuleFilePath[]): {
    status: "complete" | "incomplete" | "error";
    errors: { moduleFilePath: ModuleFilePath; key: string; message: string }[];
  } {
    const errors: {
      moduleFilePath: ModuleFilePath;
      key: string;
      message: string;
    }[] = [];
    let incomplete = false;
    for (const moduleFilePath of moduleFilePaths) {
      const source = this.sources[moduleFilePath];
      if (source === undefined) {
        // The module's source has not arrived, so its key set is unknown and
        // nothing here can be claimed loaded. Transient: intake loads every
        // module.
        incomplete = true;
        continue;
      }
      if (!isJsonObject(source)) {
        // Here, but not a record to enumerate — a nullable jsonValues record
        // whose value is null. It has no entries, so it contributes nothing;
        // reporting `incomplete` would freeze a guard at "checking" forever.
        continue;
      }
      const here = this.jsonEntries.get(moduleFilePath);
      for (const [key, value] of Object.entries(source)) {
        if (!Internal.isJson(value)) continue;
        if (here?.has(key) === true) continue;
        const message = this.entryFailures.get(entryKey(moduleFilePath, key));
        if (message !== undefined) {
          errors.push({ moduleFilePath, key, message });
          continue;
        }
        incomplete = true;
      }
    }
    const next: EntriesStatus =
      errors.length > 0
        ? { status: "error", errors }
        : { status: incomplete ? "incomplete" : "complete", errors };
    /**
     * Reference-stable, by recompute-and-compare — the same contract as
     * {@link peek} and for the same reason: this is read on a render path, and a
     * hook that returns a fresh object every render is a render loop as soon as
     * anything downstream puts it in an effect's dependencies. `useKeysOf` did
     * exactly that, through `useReferenceScanStatus`, and the record route it
     * feeds re-rendered until React gave up with "Maximum update depth
     * exceeded".
     *
     * Keyed on the requested modules, because the answer is about them: two
     * callers asking about different sets must not evict each other.
     */
    const cacheKey = moduleFilePaths.join("\n");
    const previous = this.entriesStatusCache.get(cacheKey);
    if (previous !== undefined && sameEntriesStatus(previous, next)) {
      return previous;
    }
    this.entriesStatusCache.set(cacheKey, next);
    return next;
  }

  private entriesStatusCache = new Map<string, EntriesStatus>();

  /**
   * Why this entry's last fetch failed, if it did.
   *
   * `peek` already reports it for a path INSIDE the entry. This answers for the
   * entry itself, which is what a record row needs: the row knows its key and has
   * no path to peek at until the content it is waiting for arrives.
   */
  entryError(moduleFilePath: ModuleFilePath, key: string): string | undefined {
    return this.entryFailures.get(entryKey(moduleFilePath, key));
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
   *
   * ## Reference-stable, and that is part of the contract
   *
   * Peeking the same unchanged path twice returns the SAME OBJECT. Callers rely on
   * it: `useSyncExternalStore` requires a snapshot that only changes when the
   * value does, and a fresh object per call makes React re-render forever. The
   * same requirement bit `ValidationStore.peek` and `RenderStore.peek`, and all
   * three now honour it — "safe to call on a render path" has to mean this, or it
   * means nothing.
   *
   * ## Why compare rather than invalidate
   *
   * The tempting implementation is a memo cleared wherever the answer could
   * change. That list is longer than it looks: the module's source (`bump`), its
   * SCHEMA arriving (another store), entry content landing, a fetch starting, a
   * fetch failing. Five places, one of them across a store boundary, and a missed
   * one is a field frozen on a stale value with nothing to say so.
   *
   * So the answer is always recomputed — `peek` is cheap, it is a path walk — and
   * only the OBJECT is reused, when the recomputed answer is the same answer. No
   * invalidation list to keep complete, and a new way for source to change cannot
   * break it. The same reasoning as `PatchSetChain`'s prefix test.
   */
  peek(path: SourcePath): SourcePeek {
    const next = this.computePeek(path, this.sources);
    const previous = this.peeked.get(path);
    if (previous !== undefined && samePeek(previous, next)) {
      return previous;
    }
    this.peeked.set(path, next);
    return next;
  }

  private computePeek(
    path: SourcePath,
    from: Record<ModuleFilePath, Json>,
  ): SourcePeek {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(path);
    const source = from[moduleFilePath];
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
      const cacheKey = entryKey(moduleFilePath, resolved.key);
      if (this.loadingEntries.has(cacheKey)) {
        return { status: "entry-loading", key: resolved.key };
      }
      const failed = this.entryFailures.get(cacheKey);
      if (failed !== undefined) {
        // Checked BEFORE reporting `entry-missing`, so a caller that retries on
        // missing does not loop on a fetch that is never going to work.
        return { status: "entry-failed", key: resolved.key, message: failed };
      }
      return { status: "entry-missing", key: resolved.key };
    }
    const revision = this.revisionOf(moduleFilePath);
    if (resolved.status === "found") {
      return { status: "ready", revision, data: resolved.value };
    }
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
      // The shared fetch's outcome, not an assumed success. Reporting `ok` for a
      // load that failed sent the caller on to resolve a path whose marker is
      // still there, so the real reason was replaced by "was loaded but its
      // content is still missing".
      const shared = this.entryFailures.get(cacheKey);
      return shared === undefined
        ? { status: "ok" }
        : { status: "error", message: shared };
    }
    let failure: string | undefined;
    // Cleared before the attempt, so a retry is not reported as failed while it
    // is in flight — `peek` would otherwise answer `entry-failed` for a fetch
    // that is currently working.
    this.entryFailures.delete(cacheKey);
    const request = (async () => {
      this.activity.work("source:load-json-entry", moduleFilePath);
      const res = await this.fetchJsonEntry!(moduleFilePath, key);
      if (res.status === "error") {
        failure = res.message;
        this.entryFailures.set(cacheKey, res.message);
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

  /**
   * The COMMITTED value at a path — what the server has, before local patches.
   *
   * For a diff or compare view: "what did this look like before I touched it".
   * Reads `baseSources` rather than `sources`, and is otherwise the same walk, so
   * the two answers are comparable by construction.
   *
   * Reference-stable like {@link peek}, and it has to be for the same reason: a
   * compare view is a `useSyncExternalStore` consumer too.
   */
  peekBase(path: SourcePath): SourcePeek {
    const next = this.computePeek(path, this.baseSources);
    const previous = this.peekedBase.get(path);
    if (previous !== undefined && samePeek(previous, next)) {
      return previous;
    }
    this.peekedBase.set(path, next);
    return next;
  }

  /**
   * How many `.jsonValues()` entries a module has, and how many are here.
   *
   * For a progress indicator. Counted rather than tracked incrementally: the two
   * numbers come from the source and the loaded map, so they cannot disagree with
   * what a read would find — which an incremental counter could, and would then be
   * a progress bar that finishes before the content arrives.
   */
  entriesProgress(moduleFilePath: ModuleFilePath): {
    total: number;
    loaded: number;
    failed: number;
  } {
    const source = this.sources[moduleFilePath];
    if (source === undefined || !isJsonObject(source)) {
      return { total: 0, loaded: 0, failed: 0 };
    }
    const here = this.jsonEntries.get(moduleFilePath);
    let total = 0;
    let loaded = 0;
    let failed = 0;
    for (const [key, value] of Object.entries(source)) {
      if (!Internal.isJson(value)) continue;
      total++;
      if (here?.has(key) === true) {
        loaded++;
      } else if (this.entryFailures.has(entryKey(moduleFilePath, key))) {
        failed++;
      }
    }
    return { total, loaded, failed };
  }

  /**
   * Ask again for an entry whose fetch failed.
   *
   * The only way out of `entry-failed`: `peek` reports it and every reader stops
   * asking, deliberately, so that a permanent failure is not a retry loop. Someone
   * has to be able to say "try again", and it has to clear the failure first or
   * `loadEntry` would return the recorded error without attempting anything.
   */
  async retryEntry(
    moduleFilePath: ModuleFilePath,
    key: string,
  ): Promise<{ status: "ok" } | { status: "error"; message: string }> {
    this.entryFailures.delete(entryKey(moduleFilePath, key));
    return this.loadEntry(moduleFilePath, key);
  }

  /**
   * Make the patched value the BASE value, for modules whose patches just landed.
   *
   * For the moment after a publish. The patches are now in the repository, so the
   * chain that produced this value is about to be dropped — and dropping it while
   * the base is still the pre-publish text would revert every published field on
   * screen until the next source fetch arrives. The engine calls this "baking",
   * and needs ~20 lines for it; here it is an assignment, because the store
   * already keeps base and patched apart.
   *
   * No `bump`: the VALUE does not change. That is the entire point — the base
   * swaps out from under the patched view atomically and nothing repaints. A
   * revision bump would wake every field to tell it nothing happened.
   *
   * The next real `receive()` overwrites this with the authoritative text, so if
   * the server's version differs from what was on screen, that read is what heals
   * it.
   */
  promoteToBase(modules: readonly ModuleFilePath[]): void {
    for (const moduleFilePath of modules) {
      const patched = this.sources[moduleFilePath];
      if (patched === undefined) continue;
      this.activity.work("source:promote-to-base", moduleFilePath);
      this.baseSources[moduleFilePath] = deepClone(patched as JSONValue);
    }
  }

  /**
   * Forget these patches WITHOUT rebuilding source.
   *
   * The counterpart to the drop that `patch:drop` triggers, and the difference is
   * the whole reason both exist. A dropped patch was refused: its effect must
   * disappear, so source is rebuilt from base plus what survives. A PUBLISHED
   * patch's effect must stay: it is in the base now, so rebuilding would be
   * correct only if the base had already been refetched, and until then it would
   * revert the value on screen.
   *
   * So: take them out of the chain and leave `sources` alone. Pair it with
   * {@link promoteToBase} and the displayed value never moves.
   */
  forgetPublished(patchIds: readonly PatchId[]): void {
    const published = new Set(patchIds);
    for (const [moduleFilePath, chain] of this.chains) {
      const surviving = chain.filter(
        (entry) => !published.has(entry.record.patchId),
      );
      if (surviving.length !== chain.length) {
        this.chains.set(moduleFilePath, surviving);
      }
    }
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
    const offDrop = patchStore.events.on("patch:drop", (event) => {
      this.dropFromChains(event.patches, event.modules);
    });
    return () => {
      offReceive();
      offCreate();
      offDrop();
    };
  }

  /**
   * Forget these patches and rebuild the modules they touched.
   *
   * An applied patch cannot be un-applied: a JSON patch is not invertible in
   * general (a `replace` does not record what it replaced), so "remove the
   * middle patch" can only mean recompute base + the surviving chain. That is
   * the same rebase `receive()` does, which is why the chain is kept in the
   * first place — and it is the reason a drop is affordable at all.
   *
   * Listeners are woken with origin `external`. A dropped patch is news to every
   * field including the one that made it: the field that typed the value is
   * exactly the one now showing something that no longer exists, so leaving it
   * asleep — the suppression the normal path applies — would leave the wrong
   * value on screen.
   */
  private dropFromChains(
    patchIds: readonly PatchId[],
    modules: readonly ModuleFilePath[],
  ): void {
    const dropped = new Set(patchIds);
    const rebuilt: ModuleFilePath[] = [];
    /**
     * The paths the dropped patches touched.
     *
     * Collected from the chain entries being removed, because those are the only
     * remaining copy: `PatchStore.drop` has already deleted the records by the
     * time this event arrives, and the event carries ids and modules rather than
     * ops. Needed for the wake — a dropped `replace` changes exactly the paths it
     * originally changed, so those are the readers that are now wrong.
     */
    const touched: SourcePath[] = [];
    for (const moduleFilePath of modules) {
      const chain = this.chains.get(moduleFilePath);
      if (chain !== undefined) {
        const surviving = chain.filter(
          (entry) => !dropped.has(entry.record.patchId),
        );
        if (surviving.length === chain.length) {
          // Nothing of this module's chain was dropped, so its source is
          // already right. Skipping keeps a rebuild from bumping a revision
          // and waking every reader for no change.
          continue;
        }
        for (const entry of chain) {
          if (!dropped.has(entry.record.patchId)) continue;
          touched.push(...touchedSourcePaths(entry.record));
        }
        this.chains.set(moduleFilePath, surviving);
      }
      const base = this.baseSources[moduleFilePath];
      if (base === undefined) {
        // Never loaded, so there is no source to rebuild. The chain edit above
        // still had to happen, or the patch would re-land when it does load.
        continue;
      }
      this.activity.work("source:rebuild-module", moduleFilePath);
      this.sources[moduleFilePath] = deepClone(base as JSONValue);
      this.bump(moduleFilePath);
      rebuilt.push(moduleFilePath);
    }
    if (rebuilt.length > 0) {
      // Announced BEFORE re-applying, so a consumer sees "these modules went
      // back to base" and then the applies that follow, in that order. The
      // reverse order would show the surviving patches landing on a value that,
      // as far as any consumer could tell, still had the dropped one in it.
      this.events.emit({ type: "source:patch-drop", modules: rebuilt });
      for (const moduleFilePath of rebuilt) {
        const chain = this.chains.get(moduleFilePath);
        if (chain === undefined || chain.length === 0) continue;
        this.applyEntries(
          // Origin forced to `external` for the reason in the doc comment: the
          // author of a dropped patch is a reader who must be woken, not
          // suppressed.
          chain.map((entry) => ({
            record: entry.record,
            origin: "external",
            creatorFieldId: undefined,
          })),
        );
      }
      // AFTER the re-apply, and unconditionally rather than left to it.
      //
      // The re-apply wakes the paths the SURVIVING patches touch, which is not
      // the same set — dropping a module's only patch leaves nothing to apply,
      // and the paths that patch had changed would then be woken by nobody. So
      // the drop does its own wake, with no `creatorFieldId`: a dropped patch is
      // news to every reader including its author, who is precisely the one
      // still showing a value that no longer exists.
      if (touched.length > 0) {
        this.wakeListeners(new Set(rebuilt), [
          { origin: "external", creatorFieldId: undefined, paths: touched },
        ]);
      }
    }
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
    // And wake everyone reading these modules.
    //
    // Intake replaces the value at EVERY path in the module, and `bump` above has
    // already moved the revision — but nothing had told the listeners, so a field
    // that mounted before its module arrived was never woken and rendered
    // `loading` forever. That is the normal startup order, and it stayed invisible
    // until a React hook subscribed per path: every existing test either received
    // before listening, or read on demand rather than waiting to be told.
    //
    // The module file path is the touched path, which matches everything
    // registered inside that module — `touchesPath` is prefix-wise within a
    // module — and the whole module genuinely did change.
    //
    // Origin `external` with no creator: intake is nobody's own edit, so there is
    // no instance to leave asleep.
    const loaded = (Object.keys(sources) as ModuleFilePath[]).filter(
      (moduleFilePath) => this.sources[moduleFilePath] !== undefined,
    );
    if (loaded.length > 0) {
      this.wakeListeners(new Set(loaded), [
        { origin: "external", creatorFieldId: undefined, paths: loaded },
      ]);
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
    const paths = this.listenersByModule.get(moduleFilePath);
    return paths === undefined ? [] : [...paths];
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
    const [listenModule] = Internal.splitModuleFilePathAndModulePath(path);
    let inModule = this.listenersByModule.get(listenModule);
    if (inModule === undefined) {
      inModule = new Set();
      this.listenersByModule.set(listenModule, inModule);
    }
    inModule.add(path);
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
          // Kept in step with `listenerTargets`, which is the risk of holding
          // the same fact twice: a path left here after its target is gone would
          // widen every later render scope to cover a field that unmounted.
          const stillInModule = this.listenersByModule.get(listenModule);
          if (stillInModule !== undefined) {
            stillInModule.delete(path);
            if (stillInModule.size === 0) {
              this.listenersByModule.delete(listenModule);
            }
          }
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
    this.wakeListeners(changedModules, wokenBy);
  }

  /**
   * Wake every listener on a changed path, except the one that caused it.
   *
   * Extracted from {@link applyEntries} because a DROP has to wake the same way
   * an apply does — and dropping the last patch of a module reaches this with
   * nothing to apply at all. The first version of the drop path relied on the
   * re-apply of the surviving chain to do the waking, which meant that dropping
   * a module's only patch reset its source to base and told nobody: the field
   * showing the rejected value kept showing it.
   */
  private wakeListeners(
    changedModules: Set<ModuleFilePath>,
    wokenBy: {
      origin: PatchOrigin;
      creatorFieldId?: string;
      /**
       * What changed, at either granularity — see `ChangedPath`. A patch names
       * exact paths; intake can only name modules, and a module matches
       * everything registered inside it.
       */
      paths: ChangedPath[];
    }[],
  ): void {
    // Scoped to the modules that actually changed, not the whole registry.
    //
    // Equivalent by construction rather than by approximation: every path in
    // `touched` came from a record whose module is in `changedModules`, and
    // `touchesPath` only ever matches within one module — so a registered path
    // in some other module could not have matched, and skipping it cannot lose
    // a wake.
    //
    // This was a measured defect, not a tidy-up. With one page open — 60 fields
    // of one module, 1202 mounted across the project — a burst of 40 keystrokes
    // walked the full registry 40 times, ~48k comparisons, and the stores came
    // out SLOWER than the engine on that scenario. The design's own note said
    // the scan was O(registered paths) while promising cost proportional to
    // affected fields; those are not the same thing and the browser found the
    // gap.
    const candidates = new Set<SourcePath>();
    for (const moduleFilePath of changedModules) {
      const registered = this.listenersByModule.get(moduleFilePath);
      if (registered === undefined) continue;
      for (const path of registered) {
        candidates.add(path);
      }
    }
    this.activity.work("source:scan-listeners", undefined, candidates.size);
    for (const path of candidates) {
      const byField = this.listenerTargets.get(path);
      if (byField === undefined) continue;
      const touching = wokenBy.filter((group) =>
        touchesPath(group.paths, path),
      );
      if (touching.length === 0) continue;
      // Per matched path, not per registered path: only paths that are actually
      // being woken pay for the split.
      const [wokenModule] = Internal.splitModuleFilePathAndModulePath(path);
      const revision = this.revisionOf(wokenModule);
      for (const [fieldId, entry] of byField) {
        /**
         * The first group this field did NOT cause.
         *
         * Defensive, and honestly so: this used to take the first group that
         * touched the path and skip the field if that group was its own, which
         * is wrong in principle — a second group from a different creator should
         * still wake it. No test fails without this, because the only place that
         * hands `applyEntries` a mixed-creator batch is `receive`'s rebase, and
         * `receive` follows it with a blanket wake of every listener in the
         * module. So the old rule was masked rather than harmless. Asking each
         * listener whether ANY touching group is somebody else's costs the same
         * and stops depending on that coincidence.
         */
        const wokenByGroup = touching.find(
          (group) => group.creatorFieldId !== fieldId,
        );
        // Everyone except the instance that caused it — which is what makes a
        // studio field and an inline overlay on one path both update, while the
        // instance being typed into is not interrupted by its own keystroke.
        if (wokenByGroup === undefined) continue;
        this.activity.work("source:wake-listener", path);
        const detail: FieldEvent = {
          type: `${wokenByGroup.origin}-patch`,
          path,
          revision,
        };
        entry.target.dispatchEvent(new CustomEvent(FIELD_EVENT, { detail }));
      }
    }
  }
}

const FIELD_EVENT = "val:field-changed";

/**
 * Is this the same peek answer?
 *
 * The value is compared by IDENTITY, which is exact for the case that matters:
 * `peek` returns a reference into the store's own source, so an unchanged value is
 * the same object, and an unchanged primitive is `===` regardless.
 *
 * **The known imprecision**, recorded because it is real: `applyPatch` clones the
 * module it patches, so after an edit to a SIBLING path, an object-valued path in
 * the same module resolves to a new object that is structurally identical to the
 * old one. This reports it as changed. It cannot produce a wrong value — the value
 * is right either way — but it can cost one extra render of an object-valued field
 * whose contents did not move. Fixing it needs structural sharing in the apply or
 * a content hash per path, and neither is worth doing before something measures
 * it.
 */
function samePeek(a: SourcePeek, b: SourcePeek): boolean {
  if (a.status !== b.status) {
    return false;
  }
  if (a.status === "ready" && b.status === "ready") {
    return a.data === b.data && a.revision.n === b.revision.n;
  }
  if (a.status === "absent" && b.status === "absent") {
    return a.revision.n === b.revision.n;
  }
  if (a.status === "entry-failed" && b.status === "entry-failed") {
    return a.key === b.key && a.message === b.message;
  }
  if (
    (a.status === "entry-missing" && b.status === "entry-missing") ||
    (a.status === "entry-loading" && b.status === "entry-loading")
  ) {
    return a.key === b.key;
  }
  // `module-loading` carries nothing, so two of them are the same answer.
  return a.status === "module-loading";
}

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
