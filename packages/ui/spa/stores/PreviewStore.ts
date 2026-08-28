import type {
  ModuleFilePath,
  ReifiedPreview,
  SourcePath,
} from "@valbuild/core";
import { Internal } from "@valbuild/core";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
import type { HostBridge } from "./bridges";
import type { SourceStore } from "./SourceStore";
import type { SchemaStore } from "./SchemaStore";
import { noopActivity, type ActivitySink } from "./activity";

export type PreviewRead =
  | { status: "previewed"; preview: NonNullable<ReifiedPreview[SourcePath]> }
  /**
   * Nothing is computed for this module, and computing it might help.
   *
   * `peek` only. It exists because a caller that peeks has to know whether ASKING
   * would change the answer, and the first version of `peek` could not say: it
   * returned `no-preview` both for a module that declares no preview and for one
   * that simply has not been computed yet. A React hook reading that cannot
   * distinguish "there is nothing to show" from "ask and there will be", so it
   * either never shows anything or asks forever. Exactly the same defect, and
   * the same fix, as `entry-missing` vs `entry-failed` in `SourceStore.peek`.
   *
   * `get` never returns it — `get` computes, so by the time it answers the
   * question is settled.
   */
  | { status: "needs-preview" }
  /**
   * The module previewed, but this path has no preview of its own. Normal and
   * common — only an array or a record that declares a `preview` has one.
   * Distinct from `no-preview`, which is about the whole module.
   */
  | { status: "no-preview-at-path" }
  /** The module declares no previews at all, or the host has no instance. */
  | { status: "no-preview" }
  | { status: "error"; message: string };

/**
 * Are these the same whole-project preview maps?
 *
 * Identity per module, for the same reason {@link sameRead} uses it: a preview
 * that has not been recomputed is the same object out of the same cache entry,
 * so `===` is exact here rather than an approximation of equality.
 */
function samePreviews(
  a: Record<ModuleFilePath, ReifiedPreview | null>,
  b: Record<ModuleFilePath, ReifiedPreview | null>,
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  for (const key of keys) {
    const moduleFilePath = key as ModuleFilePath;
    if (!(moduleFilePath in b)) return false;
    if (a[moduleFilePath] !== b[moduleFilePath]) return false;
  }
  return true;
}

/**
 * Is this the same preview answer? Identity on the preview, since an unchanged
 * one is the same object out of the same cache entry.
 */
function sameRead(a: PreviewRead, b: PreviewRead): boolean {
  if (a.status !== b.status) {
    return false;
  }
  if (a.status === "previewed" && b.status === "previewed") {
    return a.preview === b.preview;
  }
  if (a.status === "error" && b.status === "error") {
    return a.message === b.message;
  }
  return true;
}

/**
 * REALM: host. Routes to {@link HostBridge}; computes nothing itself.
 *
 * ## Why it is a router and not a computer
 *
 * A preview is produced by `executePreview`, which runs the user's `preview()`
 * closures. Only the host holds those. So this store owns everything AROUND the
 * preview — the cache, the staleness, the events, the per-path lookup — and asks
 * the host for the preview itself.
 *
 * A string's `render` is NOT here and never was one of these: it is static
 * config that travels with the serialized schema, so there is nothing to ask
 * for. See `core/src/render.ts`.
 *
 * ## Per-path API, per-path execution
 *
 * Callers ask `get(path)`, and that path is now what gets previewed:
 * `executePreview` takes a `PreviewScope`, so a listener on one row of a list
 * runs the closure for that row rather than for every row. A request for the
 * CONTAINER still previews all of it — a list view needs every row, and
 * windowing there would be a list with rows missing.
 *
 * The worst case this was measured against: `handboka` previews at two nested
 * array levels, so an unscoped preview of one visible section walked every
 * chapter and every section. Scoped, it walks one of each.
 *
 * ## What that costs this store
 *
 * Two things, both of which would be silent bugs if left out:
 *
 * - **The cache entry carries the scope it was computed at.** A preview scoped
 *   to one row says nothing about another row, so serving it there is worse than a
 *   miss — a miss is slow, that is wrong. Coverage is asked per CALLER and not
 *   as "is every listened path covered": folding those together makes one
 *   field's read pay for every other mounted field's, which is the fan-out this
 *   design exists to remove.
 * - **Concurrent readers of different paths must still cost one preview.**
 *   Sharing an already-issued request cannot achieve that, because its scope was
 *   fixed when it was issued. See `refreshFor`.
 */
export class PreviewStore {
  readonly events = new StoreBus<SystemEvent>();

  /**
   * The cached preview per module, WITH the scope it was computed for.
   *
   * `scope: null` means the whole module. A scoped preview answers for the paths
   * in its scope and for nothing else — so the scope is part of the cache entry,
   * not a detail of how it was produced. Without it, a preview computed for one
   * visible row would be served to a field on another row that it says nothing
   * about, which is worse than a cache miss: a miss is slow, this is wrong.
   */
  private previews = new Map<
    ModuleFilePath,
    { preview: ReifiedPreview; scope: Set<SourcePath> | null }
  >();
  private stale = new Set<ModuleFilePath>();
  /**
   * Memoised {@link peek} answers, so repeated peeks of one path are `===`.
   *
   * Cleared per MODULE, because everything that can change a preview — an
   * invalidation, a recompute, an error — is a module-level event. Keyed by path
   * because that is what a caller asks about.
   */
  private peeked = new Map<SourcePath, PreviewRead>();
  /**
   * Deferred cache teardowns, per module. See the `source:unlisten` handler.
   * Cleared by {@link dispose} so a discarded system leaves no timers behind.
   */
  private pendingForget = new Map<
    ModuleFilePath,
    ReturnType<typeof setTimeout>
  >();

  /**
   * In-flight requests, so N fields asking at once produce ONE host call — WITH
   * the scope each was issued at.
   *
   * The scope has to be here for the same reason it is on the cache entry: a
   * request already sent to the host answers for the paths it was sent with and
   * no others, so "is there one in flight" is not the question. "Is there one in
   * flight that will answer MY question" is.
   */
  private inFlight = new Map<
    ModuleFilePath,
    { scope: ReadonlySet<SourcePath> | null; request: Promise<void> }
  >();
  /**
   * Reads that have asked but whose preview has not gone out yet.
   *
   * The set of paths is mutable and shared with the pending request, so a reader
   * arriving in the same turn widens the scope of the preview that is about to be
   * issued instead of needing one of its own. See {@link refreshFor}.
   */
  private pendingReads = new Map<
    ModuleFilePath,
    { paths: Set<SourcePath>; request: Promise<void> }
  >();
  /**
   * How many readers are registered on paths in each module.
   *
   * This is the demand signal, and it is the reason this store listens to the
   * source store's registry rather than waiting to be called. A preview is only
   * worth computing if someone is looking at it; a listener existing at a path
   * is the system's own record that someone is. `get()` cannot serve as that
   * signal — it is a caller choosing to pay, which a speculative or
   * already-unmounted caller can also do.
   */
  private listenersByModule = new Map<ModuleFilePath, number>();

  /** The last {@link all} answer, reused when a fresh one is equal. */
  private allPreviews: Record<ModuleFilePath, ReifiedPreview | null> | null =
    null;

  constructor(
    private readonly host: HostBridge,
    private readonly sourceStore: SourceStore,
    private readonly schemaStore: SchemaStore,
    private readonly activity: ActivitySink = noopActivity,
  ) {}

  /**
   * A preview is a function of (schema, source), so both invalidate it. Missing
   * the schema half is how an HMR edit leaves a stale preview on screen.
   */
  listenTo(): () => void {
    // Demand arriving: a field mounted on a path in this module, so its preview
    // is now wanted. Computed at that point — which is the "user clicks to a
    // path that needs a preview" case — rather than when someone calls `get()`.
    const offListen = this.sourceStore.events.on("source:listen", (event) => {
      const before = this.listenersByModule.get(event.moduleFilePath) ?? 0;
      this.listenersByModule.set(event.moduleFilePath, before + 1);
      // Demand came back before the deferred teardown ran — see `source:unlisten`
      // below. Keeping the cache is the point: this is the remount half of a
      // virtualizer's row swap, and dropping it here is what looped.
      const pending = this.pendingForget.get(event.moduleFilePath);
      if (pending !== undefined) {
        clearTimeout(pending);
        this.pendingForget.delete(event.moduleFilePath);
      }
      // The FIRST field to look at a module is what makes it preview. Later
      // listeners deliberately do not trigger one, and that is the coalescing:
      // a commit mounting twenty rows would otherwise refresh twenty times at
      // growing scope — strictly worse than the one whole-module preview this
      // replaced. Their own reads cover them, and the first of those reads
      // previews at the scope of everything mounted by then, so the twenty rows
      // cost two previews rather than twenty.
      if (
        this.previews.has(event.moduleFilePath) ||
        this.inFlight.has(event.moduleFilePath) ||
        this.pendingReads.has(event.moduleFilePath)
      ) {
        return;
      }
      void this.refresh(event.moduleFilePath);
    });
    /**
     * Demand leaving. The cache is dropped once nobody is looking, so a module
     * nobody has on screen cannot be recomputed by a later change to it, and
     * does not hold a preview nobody will read.
     *
     * DEFERRED BY A TICK, and that is the whole fix for a re-render loop.
     *
     * "Nobody is looking" is not the same as "the count reached zero", because
     * React commits an unmount BEFORE the mount that replaces it. A virtualizer
     * scrolling one row out and another in therefore passes through zero even
     * though the module is still very much on screen. Dropping the cache there
     * made the incoming row's read a cache MISS, which re-previewed the whole
     * module, which produced new preview objects, which re-rendered the rows,
     * which moved the window again: 550 mount/unmount pairs on a 121-row record
     * and then "Maximum update depth exceeded".
     *
     * It surfaced from inside a Radix ref callback in the NAV MENU, which is not
     * even in this subtree — the cascade simply exhausted React's budget wherever
     * a component measured itself. Stubbing the nav out did not help; counting
     * `source:listen` against `source:change` is what found it (550 against 17).
     *
     * A tick is enough: a remount lands in the same commit, so anything still
     * wanted has re-registered by the time the timer runs. The check is repeated
     * inside the callback rather than trusted from outside it.
     */
    const offUnlisten = this.sourceStore.events.on(
      "source:unlisten",
      (event) => {
        const before = this.listenersByModule.get(event.moduleFilePath) ?? 0;
        const after = before - 1;
        if (after > 0) {
          this.listenersByModule.set(event.moduleFilePath, after);
          return;
        }
        this.listenersByModule.delete(event.moduleFilePath);
        const moduleFilePath = event.moduleFilePath;
        const existing = this.pendingForget.get(moduleFilePath);
        if (existing !== undefined) {
          clearTimeout(existing);
        }
        this.pendingForget.set(
          moduleFilePath,
          setTimeout(() => {
            this.pendingForget.delete(moduleFilePath);
            // Still nobody? A remount during the commit would have re-registered
            // and cancelled this, but check anyway: the timer is not the truth.
            if ((this.listenersByModule.get(moduleFilePath) ?? 0) > 0) {
              return;
            }
            this.previews.delete(moduleFilePath);
            this.stale.delete(moduleFilePath);
            this.pendingReads.delete(moduleFilePath);
          }, 0),
        );
      },
    );
    const offApply = this.sourceStore.events.on(
      "source:patch-apply",
      (event) => {
        this.invalidate(event.modules);
      },
    );
    const offInit = this.sourceStore.events.on("source:init", (event) => {
      this.invalidate(event.sources);
    });
    const offSchema = this.schemaStore.events.on("schema:init", (event) => {
      this.invalidate(event.modules);
    });
    return () => {
      offListen();
      offUnlisten();
      offApply();
      offInit();
      offSchema();
      // Timers outlive listeners otherwise, and a test that creates and
      // discards systems in one process would leak them into the next.
      for (const timer of this.pendingForget.values()) {
        clearTimeout(timer);
      }
      this.pendingForget.clear();
    };
  }

  /**
   * Bumped by every invalidation, so a preview in flight can tell whether the
   * world moved underneath it. See {@link computePreview}.
   */
  private generation = 0;

  private invalidate(modules: ModuleFilePath[]): void {
    this.generation++;
    const newlyStale = modules.filter(
      (moduleFilePath) =>
        !this.stale.has(moduleFilePath) && this.previews.has(moduleFilePath),
    );
    for (const moduleFilePath of modules) {
      this.stale.add(moduleFilePath);
    }
    // Only when something cached actually went stale. A keystroke in a module
    // nobody has previewed is not news, and 40 keystrokes in one that has are
    // one piece of news, not 40.
    if (newlyStale.length > 0) {
      this.events.emit({ type: "preview:invalidate", modules: newlyStale });
    }
    // And that is ALL a change does. It deliberately does not recompute, not
    // even for a module someone is looking at: a burst of 40 keystrokes would
    // then cost 40 whole-module previews, which is precisely the per-keystroke
    // preview cost this design exists to remove.
    //
    // Nothing is lost by waiting, because the change already wakes the fields
    // on the affected paths (the source store dispatches to them in the same
    // call), and a woken field re-reads. So the read that follows is what pays,
    // once, however many changes preceded it. The eager case is demand
    // ARRIVING — see `source:listen` above — not demand being disturbed.
  }

  /**
   * The preview at one path, computing it (once, per module) if needed.
   *
   * Async because it may cross the host seam. Concurrent callers on the same
   * module share one in-flight request rather than each triggering their own
   * `executePreview` over the whole module.
   */
  async get(path: SourcePath): Promise<PreviewRead> {
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    if (this.stale.has(moduleFilePath) || !this.covers(moduleFilePath, path)) {
      this.activity.work("preview:cache-miss", moduleFilePath);
      await this.refreshFor(moduleFilePath, path);
    } else {
      this.activity.work("preview:cache-hit", moduleFilePath);
    }
    const entry = this.previews.get(moduleFilePath);
    if (entry === undefined) {
      return { status: "no-preview" };
    }
    // `executePreview` keys every preview by its exact `sourcePath`, and a
    // module's own preview lands under the bare module file path — that IS its
    // source path,
    // `joinModuleFilePathAndModulePath(mfp, "")` being `mfp`.
    //
    // The fallback is deliberate and load-bearing, which is worth saying because
    // it reads like an over-broad default: a WINDOWED container preview is keyed
    // under the container, and a row asks about its OWN path and finds itself in
    // that preview's `items` (which carry their index — see `ArrayPreview`).
    // Only a container can be keyed at a container path, so the fallback cannot
    // hand a field something that was never about it.
    // Scoping this to the module root breaks exactly that, and
    // `demandDriven.test.ts` says so in three tests.
    const at =
      entry.preview[path] ??
      entry.preview[moduleFilePath as string as SourcePath];
    if (at === undefined) {
      return { status: "no-preview-at-path" };
    }
    return { status: "previewed", preview: at };
  }

  /**
   * Does the cached preview answer for this path?
   *
   * Only about the one path, deliberately. A cache entry that covers the caller
   * but not some other mounted field is a HIT for this caller: that other field
   * will ask, and its own ask is what widens the scope. Folding "is every
   * listened path covered" in here instead makes one field's read pay for
   * everyone else's, which is the fan-out this design exists to remove.
   */
  private covers(moduleFilePath: ModuleFilePath, path: SourcePath): boolean {
    const entry = this.previews.get(moduleFilePath);
    if (entry === undefined) return false;
    return entry.scope === null || entry.scope.has(path);
  }

  /**
   * Preview for a reader at `forPath`, joining any request that has not yet gone
   * out.
   *
   * The waiting is what makes N concurrent readers of N DIFFERENT paths cost one
   * preview rather than N. Sharing an already-issued request cannot do it: its
   * scope was fixed when it was issued, so a reader that joins late is either
   * served an answer that says nothing about its path, or has to start a second
   * preview. Collecting the asked-for paths first and issuing once covers both.
   *
   * The wait is a microtask, so it is free by contract — `get` is async
   * already — and it cannot outlive the caller's own turn.
   */
  private async refreshFor(
    moduleFilePath: ModuleFilePath,
    forPath: SourcePath,
  ): Promise<void> {
    let pending = this.pendingReads.get(moduleFilePath);
    if (pending !== undefined) {
      // Counted, because "N fields asking at once cost ONE host call" is a
      // claim this store makes and a test should be able to hold it to it.
      this.activity.work("preview:share-in-flight", moduleFilePath);
      pending.paths.add(forPath);
      return pending.request;
    }
    const paths = new Set<SourcePath>([forPath]);
    const request = (async () => {
      // Yield once, so every reader in this turn is in `paths` before the scope
      // is fixed. Deliberately NOT done on the `source:listen` path: that one is
      // dispatched synchronously from `addListener`, and "the preview is ready
      // when the mounting field first looks" is the whole promise of computing
      // on demand arriving — a field that mounts and reads in one turn must not
      // find it missing.
      await Promise.resolve();
      this.pendingReads.delete(moduleFilePath);
      await this.computePreview(moduleFilePath, paths);
    })();
    pending = { paths, request };
    this.pendingReads.set(moduleFilePath, pending);
    return request;
  }

  /** Preview at the scope of what is listened right now. The demand-arrival path. */
  private async refresh(moduleFilePath: ModuleFilePath): Promise<void> {
    return this.computePreview(moduleFilePath, new Set());
  }

  private async computePreview(
    moduleFilePath: ModuleFilePath,
    alsoWanted: ReadonlySet<SourcePath>,
    /** Internal: set on the one retry, so sharing cannot recurse. */
    mustIssue = false,
  ): Promise<void> {
    const existing = mustIssue ? undefined : this.inFlight.get(moduleFilePath);
    if (existing !== undefined) {
      const inFlightScope = existing.scope;
      const answersUs =
        inFlightScope === null ||
        [...alsoWanted].every((path) => inFlightScope.has(path));
      this.activity.work("preview:share-in-flight", moduleFilePath);
      await existing.request;
      if (answersUs) {
        return;
      }
      // It did not answer us. One retry, and that one issues unconditionally: a
      // duplicate preview costs time, whereas returning here would report
      // `no-preview-at-path` for a path that has a preview, which is wrong. Bounded
      // by the flag rather than by an argument about interleaving.
      return this.computePreview(moduleFilePath, alsoWanted, true);
    }
    // The scope is the listened paths, plus whoever is asking. Derived here and
    // not remembered: it is a question about now, and a stored answer could only
    // grow — see `SourceStore.listenedPaths`.
    const scope = new Set(this.sourceStore.listenedPaths(moduleFilePath));
    for (const path of alsoWanted) {
      scope.add(path);
    }
    // `const` despite the self-reference in `finally` below: that callback runs
    // long after the binding is initialised.
    // Read BEFORE the await below, and compared after — see the notes on each
    // `stale.delete` in the branches.
    const startedAt = this.generation;
    const request: Promise<void> = (async () => {
      // Asked before crossing the host seam: a module whose schema declares no
      // preview cannot produce one, so the walk is pure cost. Cached as an empty
      // preview rather than skipped outright, so `get` and `peek` answer
      // `no-preview-at-path` exactly as they did when the host was asked and
      // returned nothing.
      const result = this.schemaStore.declaresPreview(moduleFilePath)
        ? await this.host.preview(moduleFilePath, [...scope])
        : { status: "previewed" as const, preview: {} };
      if (result.status === "previewed") {
        // An empty scope is not a scope: with nothing listened and nobody
        // asking, the host previewed the whole module, so that is what is cached.
        this.previews.set(moduleFilePath, {
          preview: result.preview,
          scope: scope.size === 0 ? null : scope,
        });
        /**
         * Only if nothing invalidated while the host was previewing.
         *
         * `host.preview` is awaited, so an edit can land mid-flight. Clearing
         * `stale` unconditionally cached a preview of the PRE-edit source and
         * marked it fresh, and every field on those paths kept showing it — the
         * reader only re-asks on `needs-preview`. Cached anyway, because a stale
         * preview is better than none; just not marked fresh.
         */
        if (this.generation === startedAt) {
          this.stale.delete(moduleFilePath);
        }
        this.events.emit({ type: "preview:result", moduleFilePath });
      } else if (result.status === "unknown-module") {
        // Not an error: a module with no instance simply has no preview. Cache
        // the absence so every field in it does not re-ask the host.
        this.previews.delete(moduleFilePath);
        if (this.generation === startedAt) {
          this.stale.delete(moduleFilePath);
        }
      } else {
        this.previews.delete(moduleFilePath);
        if (this.generation === startedAt) {
          this.stale.delete(moduleFilePath);
        }
        this.events.emit({
          type: "preview:error",
          moduleFilePath,
          message: result.message,
        });
      }
    })().finally(() => {
      // Only if it is still ours: a `mustIssue` retry can overlap a request that
      // was already in flight, and clearing the other one's entry would let a
      // third caller issue a third preview.
      if (this.inFlight.get(moduleFilePath)?.request === request) {
        this.inFlight.delete(moduleFilePath);
      }
    });
    this.inFlight.set(moduleFilePath, {
      scope: scope.size === 0 ? null : scope,
      request,
    });
    return request;
  }

  /**
   * Cached only: safe on a render path, never triggers a host call.
   *
   * And reference-stable, which is the other half of "safe on a render path". An
   * earlier version built its result fresh per call, so a `useSyncExternalStore`
   * consumer saw a new snapshot on every render and re-rendered forever — the
   * same defect `ValidationStore.peek` had, found the same way.
   *
   * Achieved by recomputing and comparing, not by invalidating a memo. The first
   * fix here DID keep an invalidation list — five call sites, one of them reading
   * `declaresPreview` from another store — and a list like that has to stay
   * complete forever, failing silently when it does not. Recomputing is cheap (a
   * map lookup and a property read) and cannot go stale. Same reasoning as
   * `SourceStore.peek`.
   */
  peek(path: SourcePath): PreviewRead {
    const next = this.computePeek(path);
    const previous = this.peeked.get(path);
    if (previous !== undefined && sameRead(previous, next)) {
      return previous;
    }
    this.peeked.set(path, next);
    return next;
  }

  /**
   * Every module's cached preview, in the shape the engine's whole-project
   * snapshot returned: `null` where there is nothing previewed.
   *
   * PEEKED, not computed. That is the whole difference from the engine, which
   * computed for every module the project has a schema for — so a consumer
   * reading "all previews" paid for the entire project's closures whether or not
   * anything was on screen. Here a module that nobody has asked about is simply
   * absent, and the preview arrives when demand does: a field mounting on a path
   * emits `source:listen`, which is what makes this store compute.
   *
   * A consumer that needs a preview it cannot see should read it through
   * `usePreviewAtPath` — asking IS the demand signal. Two consumers do
   * genuinely want the whole map (`useRichTextEditorConfig`, `RouteField`), and
   * for them "what has been previewed so far" is the honest answer: both are
   * reading configuration that the module they render in has already caused.
   *
   * Reference-stable, like every other snapshot here, and by recomputing and
   * comparing rather than by maintaining a version. Five places mutate the
   * preview map — a listener count reaching zero, an invalidation, and the three
   * outcomes of a preview — and a counter bumped at each is a list that has to
   * stay complete forever and fails silently when it does not. The rebuild walks
   * only modules that HAVE a cached preview, which is modules with a mounted
   * field, so it is bounded by what is on screen rather than by the project.
   * Same reasoning as `peek`, and as `SourceStore.peek` before it.
   */
  all(): Record<ModuleFilePath, ReifiedPreview | null> {
    const next: Record<ModuleFilePath, ReifiedPreview | null> = {};
    for (const [moduleFilePath, entry] of this.previews) {
      next[moduleFilePath] = this.stale.has(moduleFilePath)
        ? null
        : entry.preview;
    }
    const previous = this.allPreviews;
    if (previous !== null && samePreviews(previous, next)) {
      return previous;
    }
    this.allPreviews = next;
    return next;
  }

  private computePeek(path: SourcePath): PreviewRead {
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    // Asked FIRST, because it is the one case where asking cannot help: the
    // module's schema declares no preview at all, so there is nothing to compute
    // however many times a caller asks. Distinguishing it from the two below is
    // the whole reason `needs-preview` exists.
    if (!this.schemaStore.declaresPreview(moduleFilePath)) {
      return { status: "no-preview" };
    }
    if (this.stale.has(moduleFilePath)) {
      return { status: "needs-preview" };
    }
    const entry = this.previews.get(moduleFilePath);
    if (entry === undefined) {
      return { status: "needs-preview" };
    }
    /**
     * A path the cached preview was not computed FOR is `needs-preview`.
     *
     * This used to skip the `covers` check that `get` makes, on the grounds that
     * `peek` reports what is cached and has no third thing to say. It does have
     * one — that is what `needs-preview` is — and without it a row scrolled into
     * view was stuck: `source:listen` returns early when a preview already exists,
     * so the scope never widened, and the reader never asked because `peek`
     * answered `previewed` (the container's preview, which does not contain that
     * row) or `no-preview-at-path`. Either way the new row showed no preview until
     * something else in the module changed.
     *
     * It cannot loop: `refreshFor` puts the asked-for path in the new scope, so
     * the next `covers` is true whatever the host returned.
     */
    if (!this.covers(moduleFilePath, path)) {
      return { status: "needs-preview" };
    }
    // The container fallback, for the same reason as in `get` above — a row reads
    // the windowed container preview it appears in.
    const at =
      entry.preview[path] ??
      entry.preview[moduleFilePath as string as SourcePath];
    return at === undefined
      ? { status: "no-preview-at-path" }
      : { status: "previewed", preview: at };
  }
}
