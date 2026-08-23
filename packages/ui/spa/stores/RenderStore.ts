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
   * The module rendered, but this path has no render of its own. Normal and
   * common — most paths are not list/record/textarea/code nodes. Distinct from
   * `no-render`, which is about the whole module.
   */
  | { status: "no-render-at-path" }
  /** The module declares no renders at all, or the host has no instance. */
  | { status: "no-render" }
  | { status: "error"; message: string };

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

  private invalidate(modules: ModuleFilePath[]): void {
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
    // `executeRender` keys the module's own render under the bare module file
    // path, not under a `?p=` path, so a module-level render is looked up under
    // the module rather than being missed.
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
        this.stale.delete(moduleFilePath);
        this.events.emit({ type: "render:result", moduleFilePath });
      } else if (result.status === "unknown-module") {
        // Not an error: a module with no instance simply has no render. Cache
        // the absence so every field in it does not re-ask the host.
        this.renders.delete(moduleFilePath);
        this.stale.delete(moduleFilePath);
      } else {
        this.renders.delete(moduleFilePath);
        this.stale.delete(moduleFilePath);
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

  /** Cached only: safe on a render path, never triggers a host call. */
  peek(path: SourcePath): RenderRead {
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    if (this.stale.has(moduleFilePath)) {
      return { status: "no-render" };
    }
    const entry = this.renders.get(moduleFilePath);
    if (entry === undefined) {
      return { status: "no-render" };
    }
    // Deliberately NOT the `covers` check `get` makes. `peek` reports what is
    // cached; a path outside the scope simply has nothing at it, which is
    // `no-render-at-path` — the same answer as a path that genuinely has no
    // render. `peek` cannot fetch, so it has no third thing to say.
    const at =
      entry.render[path] ??
      entry.render[moduleFilePath as string as SourcePath];
    return at === undefined
      ? { status: "no-render-at-path" }
      : { status: "rendered", render: at };
  }
}
