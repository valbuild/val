import type { ModuleFilePath, ReifiedRender, SourcePath } from "@valbuild/core";
import { Internal } from "@valbuild/core";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
import type { HostBridge } from "./bridges";
import type { SourceStore } from "./SourceStore";
import type { SchemaStore } from "./SchemaStore";
import { noopActivity, type ActivitySink } from "./activity";

export type RenderRead =
  | { status: "rendered"; render: NonNullable<ReifiedRender[SourcePath]> }
  /**
   * Nothing is computed for this module, and computing it might help.
   *
   * `peek` only. It exists because a caller that peeks has to know whether ASKING
   * would change the answer, and the first version of `peek` could not say: it
   * returned `no-render` both for a module that declares no render and for one
   * that simply has not been computed yet. A React hook reading that cannot
   * distinguish "there is nothing to show" from "ask and there will be", so it
   * either never renders anything or asks forever. Exactly the same defect, and
   * the same fix, as `entry-missing` vs `entry-failed` in `SourceStore.peek`.
   *
   * `get` never returns it — `get` computes, so by the time it answers the
   * question is settled.
   */
  | { status: "needs-render" }
  /**
   * The module rendered, but this path has no render of its own. Normal and
   * common — most paths are not list/record/textarea/code nodes. Distinct from
   * `no-render`, which is about the whole module.
   */
  | { status: "no-render-at-path" }
  /** The module declares no renders at all, or the host has no instance. */
  | { status: "no-render" }
  | { status: "error"; message: string };

/**
 * Are these the same whole-project render maps?
 *
 * Identity per module, for the same reason {@link sameRead} uses it: a render
 * that has not been recomputed is the same object out of the same cache entry,
 * so `===` is exact here rather than an approximation of equality.
 */
function sameRenders(
  a: Record<ModuleFilePath, ReifiedRender | null>,
  b: Record<ModuleFilePath, ReifiedRender | null>,
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
 * Is this the same render answer? Identity on the render, since an unchanged one
 * is the same object out of the same cache entry.
 */
function sameRead(a: RenderRead, b: RenderRead): boolean {
  if (a.status !== b.status) {
    return false;
  }
  if (a.status === "rendered" && b.status === "rendered") {
    return a.render === b.render;
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
 * A render is produced by `executeRender`, which runs the user's `render({ as,
 * select })` closures. Only the host holds those. So this store owns everything
 * AROUND the render — the cache, the staleness, the events, the per-path lookup
 * — and asks the host for the render itself.
 *
 * ## Per-path API, per-path execution
 *
 * Callers ask `get(path)`, and that path is now what gets rendered:
 * `executeRender` takes a `RenderScope`, so a listener on one row of a list runs
 * `select` for that row rather than for every row. A request for the CONTAINER
 * still renders all of it — a list view needs every row, and windowing there
 * would be a list with rows missing.
 *
 * The worst case this was measured against: `handboka` has `select` at two nested
 * array levels, so an unscoped render of one visible section walked every chapter
 * and every section. Scoped, it walks one of each.
 *
 * ## What that costs this store
 *
 * Two things, both of which would be silent bugs if left out:
 *
 * - **The cache entry carries the scope it was computed at.** A render scoped to
 *   one row says nothing about another row, so serving it there is worse than a
 *   miss — a miss is slow, that is wrong. Coverage is asked per CALLER and not
 *   as "is every listened path covered": folding those together makes one
 *   field's read pay for every other mounted field's, which is the fan-out this
 *   design exists to remove.
 * - **Concurrent readers of different paths must still cost one render.**
 *   Sharing an already-issued request cannot achieve that, because its scope was
 *   fixed when it was issued. See `refreshFor`.
 */
export class RenderStore {
  readonly events = new StoreBus<SystemEvent>();

  /**
   * The cached render per module, WITH the scope it was computed for.
   *
   * `scope: null` means the whole module. A scoped render answers for the paths
   * in its scope and for nothing else — so the scope is part of the cache entry,
   * not a detail of how it was produced. Without it, a render computed for one
   * visible row would be served to a field on another row that it says nothing
   * about, which is worse than a cache miss: a miss is slow, this is wrong.
   */
  private renders = new Map<
    ModuleFilePath,
    { render: ReifiedRender; scope: Set<SourcePath> | null }
  >();
  private stale = new Set<ModuleFilePath>();
  /**
   * Memoised {@link peek} answers, so repeated peeks of one path are `===`.
   *
   * Cleared per MODULE, because everything that can change a render — an
   * invalidation, a recompute, an error — is a module-level event. Keyed by path
   * because that is what a caller asks about.
   */
  private peeked = new Map<SourcePath, RenderRead>();

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
   * Reads that have asked but whose render has not gone out yet.
   *
   * The set of paths is mutable and shared with the pending request, so a reader
   * arriving in the same turn widens the scope of the render that is about to be
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
   * source store's registry rather than waiting to be called. A render is only
   * worth computing if someone is looking at it; a listener existing at a path
   * is the system's own record that someone is. `get()` cannot serve as that
   * signal — it is a caller choosing to pay, which a speculative or
   * already-unmounted caller can also do.
   */
  private listenersByModule = new Map<ModuleFilePath, number>();

  /** The last {@link all} answer, reused when a fresh one is equal. */
  private allRenders: Record<ModuleFilePath, ReifiedRender | null> | null =
    null;

  constructor(
    private readonly host: HostBridge,
    private readonly sourceStore: SourceStore,
    private readonly schemaStore: SchemaStore,
    private readonly activity: ActivitySink = noopActivity,
  ) {}

  /**
   * A render is a function of (schema, source), so both invalidate it. Missing
   * the schema half is how an HMR edit leaves a stale render on screen.
   */
  listenTo(): () => void {
    // Demand arriving: a field mounted on a path in this module, so its render
    // is now wanted. Computed at that point — which is the "user clicks to a
    // path that needs a render" case — rather than when someone calls `get()`.
    const offListen = this.sourceStore.events.on("source:listen", (event) => {
      const before = this.listenersByModule.get(event.moduleFilePath) ?? 0;
      this.listenersByModule.set(event.moduleFilePath, before + 1);
      // The FIRST field to look at a module is what makes it render. Later
      // listeners deliberately do not trigger one, and that is the coalescing:
      // a commit mounting twenty rows would otherwise refresh twenty times at
      // growing scope — strictly worse than the one whole-module render this
      // replaced. Their own reads cover them, and the first of those reads
      // renders at the scope of everything mounted by then, so the twenty rows
      // cost two renders rather than twenty.
      if (
        this.renders.has(event.moduleFilePath) ||
        this.inFlight.has(event.moduleFilePath) ||
        this.pendingReads.has(event.moduleFilePath)
      ) {
        return;
      }
      void this.refresh(event.moduleFilePath);
    });
    // Demand leaving. The cache is dropped once nobody is looking, so a module
    // nobody has on screen cannot be re-rendered by a later change to it, and
    // does not hold a render nobody will read.
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
        this.renders.delete(event.moduleFilePath);
        this.stale.delete(event.moduleFilePath);
        this.pendingReads.delete(event.moduleFilePath);
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
    };
  }

  /**
   * Bumped by every invalidation, so a render in flight can tell whether the
   * world moved underneath it. See {@link render}.
   */
  private generation = 0;

  private invalidate(modules: ModuleFilePath[]): void {
    this.generation++;
    const newlyStale = modules.filter(
      (moduleFilePath) =>
        !this.stale.has(moduleFilePath) && this.renders.has(moduleFilePath),
    );
    for (const moduleFilePath of modules) {
      this.stale.add(moduleFilePath);
    }
    // Only when something cached actually went stale. A keystroke in a module
    // nobody has rendered is not news, and 40 keystrokes in one that has are
    // one piece of news, not 40.
    if (newlyStale.length > 0) {
      this.events.emit({ type: "render:invalidate", modules: newlyStale });
    }
    // And that is ALL a change does. It deliberately does not recompute, not
    // even for a module someone is looking at: a burst of 40 keystrokes would
    // then cost 40 whole-module renders, which is precisely the per-keystroke
    // render cost this design exists to remove.
    //
    // Nothing is lost by waiting, because the change already wakes the fields
    // on the affected paths (the source store dispatches to them in the same
    // call), and a woken field re-reads. So the read that follows is what pays,
    // once, however many changes preceded it. The eager case is demand
    // ARRIVING — see `source:listen` above — not demand being disturbed.
  }

  /**
   * The render at one path, computing it (once, per module) if needed.
   *
   * Async because it may cross the host seam. Concurrent callers on the same
   * module share one in-flight request rather than each triggering their own
   * `executeRender` over the whole module.
   */
  async get(path: SourcePath): Promise<RenderRead> {
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    if (this.stale.has(moduleFilePath) || !this.covers(moduleFilePath, path)) {
      this.activity.work("render:cache-miss", moduleFilePath);
      await this.refreshFor(moduleFilePath, path);
    } else {
      this.activity.work("render:cache-hit", moduleFilePath);
    }
    const entry = this.renders.get(moduleFilePath);
    if (entry === undefined) {
      return { status: "no-render" };
    }
    // `executeRender` keys every render by its exact `sourcePath`, and a module's
    // own render lands under the bare module file path — that IS its source path,
    // `joinModuleFilePathAndModulePath(mfp, "")` being `mfp`.
    //
    // The fallback is deliberate and load-bearing, which is worth saying because
    // it reads like an over-broad default: a WINDOWED container render is keyed
    // under the container, and a row asks about its OWN path and finds itself in
    // that render's `items` (which carry their index — see `ListArrayRender`).
    // Scoping this to the module root breaks exactly that, and
    // `demandDriven.test.ts` says so in three tests.
    const at =
      entry.render[path] ??
      entry.render[moduleFilePath as string as SourcePath];
    if (at === undefined) {
      return { status: "no-render-at-path" };
    }
    return { status: "rendered", render: at };
  }

  /**
   * Does the cached render answer for this path?
   *
   * Only about the one path, deliberately. A cache entry that covers the caller
   * but not some other mounted field is a HIT for this caller: that other field
   * will ask, and its own ask is what widens the scope. Folding "is every
   * listened path covered" in here instead makes one field's read pay for
   * everyone else's, which is the fan-out this design exists to remove.
   */
  private covers(moduleFilePath: ModuleFilePath, path: SourcePath): boolean {
    const entry = this.renders.get(moduleFilePath);
    if (entry === undefined) return false;
    return entry.scope === null || entry.scope.has(path);
  }

  /**
   * Render for a reader at `forPath`, joining any request that has not yet gone
   * out.
   *
   * The waiting is what makes N concurrent readers of N DIFFERENT paths cost one
   * render rather than N. Sharing an already-issued request cannot do it: its
   * scope was fixed when it was issued, so a reader that joins late is either
   * served an answer that says nothing about its path, or has to start a second
   * render. Collecting the asked-for paths first and issuing once covers both.
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
      this.activity.work("render:share-in-flight", moduleFilePath);
      pending.paths.add(forPath);
      return pending.request;
    }
    const paths = new Set<SourcePath>([forPath]);
    const request = (async () => {
      // Yield once, so every reader in this turn is in `paths` before the scope
      // is fixed. Deliberately NOT done on the `source:listen` path: that one is
      // dispatched synchronously from `addListener`, and "the render is ready
      // when the mounting field first looks" is the whole promise of computing
      // on demand arriving — a field that mounts and reads in one turn must not
      // find it missing.
      await Promise.resolve();
      this.pendingReads.delete(moduleFilePath);
      await this.render(moduleFilePath, paths);
    })();
    pending = { paths, request };
    this.pendingReads.set(moduleFilePath, pending);
    return request;
  }

  /** Render at the scope of what is listened right now. The demand-arrival path. */
  private async refresh(moduleFilePath: ModuleFilePath): Promise<void> {
    return this.render(moduleFilePath, new Set());
  }

  private async render(
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
      this.activity.work("render:share-in-flight", moduleFilePath);
      await existing.request;
      if (answersUs) {
        return;
      }
      // It did not answer us. One retry, and that one issues unconditionally: a
      // duplicate render costs time, whereas returning here would report
      // `no-render-at-path` for a path that has a render, which is wrong. Bounded
      // by the flag rather than by an argument about interleaving.
      return this.render(moduleFilePath, alsoWanted, true);
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
      // render cannot produce one, so the walk is pure cost. Cached as an empty
      // render rather than skipped outright, so `get` and `peek` answer
      // `no-render-at-path` exactly as they did when the host was asked and
      // returned nothing.
      const result = this.schemaStore.declaresRender(moduleFilePath)
        ? await this.host.render(moduleFilePath, [...scope])
        : { status: "rendered" as const, render: {} };
      if (result.status === "rendered") {
        // An empty scope is not a scope: with nothing listened and nobody
        // asking, the host rendered the whole module, so that is what is cached.
        this.renders.set(moduleFilePath, {
          render: result.render,
          scope: scope.size === 0 ? null : scope,
        });
        /**
         * Only if nothing invalidated while the host was rendering.
         *
         * `host.render` is awaited, so an edit can land mid-flight. Clearing
         * `stale` unconditionally cached a render of the PRE-edit source and
         * marked it fresh, and every field on those paths kept showing it — the
         * reader only re-asks on `needs-render`. Cached anyway, because a stale
         * render is better than none; just not marked fresh.
         */
        if (this.generation === startedAt) {
          this.stale.delete(moduleFilePath);
        }
        this.events.emit({ type: "render:result", moduleFilePath });
      } else if (result.status === "unknown-module") {
        // Not an error: a module with no instance simply has no render. Cache
        // the absence so every field in it does not re-ask the host.
        this.renders.delete(moduleFilePath);
        if (this.generation === startedAt) {
          this.stale.delete(moduleFilePath);
        }
      } else {
        this.renders.delete(moduleFilePath);
        if (this.generation === startedAt) {
          this.stale.delete(moduleFilePath);
        }
        this.events.emit({
          type: "render:error",
          moduleFilePath,
          message: result.message,
        });
      }
    })().finally(() => {
      // Only if it is still ours: a `mustIssue` retry can overlap a request that
      // was already in flight, and clearing the other one's entry would let a
      // third caller issue a third render.
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
   * `declaresRender` from another store — and a list like that has to stay
   * complete forever, failing silently when it does not. Recomputing is cheap (a
   * map lookup and a property read) and cannot go stale. Same reasoning as
   * `SourceStore.peek`.
   */
  peek(path: SourcePath): RenderRead {
    const next = this.computePeek(path);
    const previous = this.peeked.get(path);
    if (previous !== undefined && sameRead(previous, next)) {
      return previous;
    }
    this.peeked.set(path, next);
    return next;
  }

  /**
   * Every module's cached render, in the shape the engine's
   * `getAllRendersSnapshot` returned: `null` where there is nothing rendered.
   *
   * PEEKED, not computed. That is the whole difference from the engine, which
   * ran `computeRender` for every module the project has a schema for — so a
   * consumer reading "all renders" paid for the entire project's `select`
   * closures whether or not anything was on screen. Here a module that nobody
   * has asked about is simply absent, and the render arrives when demand does:
   * a field mounting on a path emits `source:listen`, which is what makes this
   * store compute.
   *
   * A consumer that needs a render it cannot see should read it through
   * `useRenderOverrideAtPath` — asking IS the demand signal. Two consumers do
   * genuinely want the whole map (`useRichTextEditorConfig`, `RouteField`), and
   * for them "what has been rendered so far" is the honest answer: both are
   * reading configuration that the module they render in has already caused.
   *
   * Reference-stable, like every other snapshot here, and by recomputing and
   * comparing rather than by maintaining a version. Five places mutate the
   * render map — a listener count reaching zero, an invalidation, and the three
   * outcomes of a render — and a counter bumped at each is a list that has to
   * stay complete forever and fails silently when it does not. The rebuild walks
   * only modules that HAVE a cached render, which is modules with a mounted
   * field, so it is bounded by what is on screen rather than by the project.
   * Same reasoning as `peek`, and as `SourceStore.peek` before it.
   */
  all(): Record<ModuleFilePath, ReifiedRender | null> {
    const next: Record<ModuleFilePath, ReifiedRender | null> = {};
    for (const [moduleFilePath, entry] of this.renders) {
      next[moduleFilePath] = this.stale.has(moduleFilePath)
        ? null
        : entry.render;
    }
    const previous = this.allRenders;
    if (previous !== null && sameRenders(previous, next)) {
      return previous;
    }
    this.allRenders = next;
    return next;
  }

  private computePeek(path: SourcePath): RenderRead {
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    // Asked FIRST, because it is the one case where asking cannot help: the
    // module's schema declares no render at all, so there is nothing to compute
    // however many times a caller asks. Distinguishing it from the two below is
    // the whole reason `needs-render` exists.
    if (!this.schemaStore.declaresRender(moduleFilePath)) {
      return { status: "no-render" };
    }
    if (this.stale.has(moduleFilePath)) {
      return { status: "needs-render" };
    }
    const entry = this.renders.get(moduleFilePath);
    if (entry === undefined) {
      return { status: "needs-render" };
    }
    /**
     * A path the cached render was not computed FOR is `needs-render`.
     *
     * This used to skip the `covers` check that `get` makes, on the grounds that
     * `peek` reports what is cached and has no third thing to say. It does have
     * one — that is what `needs-render` is — and without it a row scrolled into
     * view was stuck: `source:listen` returns early when a render already exists,
     * so the scope never widened, and the reader never asked because `peek`
     * answered `rendered` (the container's render, which does not contain that
     * row) or `no-render-at-path`. Either way the new row showed no preview until
     * something else in the module changed.
     *
     * It cannot loop: `refreshFor` puts the asked-for path in the new scope, so
     * the next `covers` is true whatever the host returned.
     */
    if (!this.covers(moduleFilePath, path)) {
      return { status: "needs-render" };
    }
    // The container fallback, for the same reason as in `get` above — a row reads
    // the windowed render it appears in.
    const at =
      entry.render[path] ??
      entry.render[moduleFilePath as string as SourcePath];
    return at === undefined
      ? { status: "no-render-at-path" }
      : { status: "rendered", render: at };
  }
}
