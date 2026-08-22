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
 * ## Per-path API, module-granular execution
 *
 * Callers ask `get(path)`. Underneath, `executeRender` takes a whole module and
 * returns `ReifiedRender` = `Record<SourcePath, WithStatus<RenderTypes>>`, so
 * one request fills the cache for every path in the module and subsequent paths
 * are served from it.
 *
 * The interface is per-path anyway, and that is the point: making renders
 * genuinely path-scoped needs a new entry point in `packages/core`, and when it
 * lands, it lands behind this signature without any caller changing. Today's
 * engine renders eagerly, per module, on every keystroke; this at least makes it
 * lazy and cached, which is the part that can be done without touching core.
 *
 * The known worst case is unchanged by this store and worth stating plainly:
 * `handboka` has `select` at two nested array levels, so ONE request still walks
 * every chapter and section. Lazy + cached turns that from per-keystroke into
 * per-change-then-read. Path-scoping is what would turn it into per-visible-row.
 */
export class RenderStore {
  readonly events = new StoreBus<SystemEvent>();

  private renders = new Map<ModuleFilePath, ReifiedRender>();
  private stale = new Set<ModuleFilePath>();
  /** In-flight requests, so N fields asking at once produce ONE host call. */
  private inFlight = new Map<ModuleFilePath, Promise<void>>();
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
      if (
        this.stale.has(event.moduleFilePath) ||
        !this.renders.has(event.moduleFilePath)
      ) {
        void this.refresh(event.moduleFilePath);
      }
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
    if (this.stale.has(moduleFilePath) || !this.renders.has(moduleFilePath)) {
      this.activity.work("render:cache-miss", moduleFilePath);
      await this.refresh(moduleFilePath);
    } else {
      this.activity.work("render:cache-hit", moduleFilePath);
    }
    const render = this.renders.get(moduleFilePath);
    if (render === undefined) {
      return { status: "no-render" };
    }
    // `executeRender` keys the module's own render under the bare module file
    // path, not under a `?p=` path, so a module-level render is looked up under
    // the module rather than being missed.
    const at = render[path] ?? render[moduleFilePath as string as SourcePath];
    if (at === undefined) {
      return { status: "no-render-at-path" };
    }
    return { status: "rendered", render: at };
  }

  private async refresh(moduleFilePath: ModuleFilePath): Promise<void> {
    const existing = this.inFlight.get(moduleFilePath);
    if (existing) {
      // Counted, because "N fields asking at once cost ONE host call" is a
      // claim this store makes and a test should be able to hold it to it.
      this.activity.work("render:share-in-flight", moduleFilePath);
      return existing;
    }
    const request = (async () => {
      const result = await this.host.render(moduleFilePath);
      if (result.status === "rendered") {
        this.renders.set(moduleFilePath, result.render);
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
      this.inFlight.delete(moduleFilePath);
    });
    this.inFlight.set(moduleFilePath, request);
    return request;
  }

  /** Cached only: safe on a render path, never triggers a host call. */
  peek(path: SourcePath): RenderRead {
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    if (this.stale.has(moduleFilePath)) {
      return { status: "no-render" };
    }
    const render = this.renders.get(moduleFilePath);
    if (render === undefined) {
      return { status: "no-render" };
    }
    const at = render[path] ?? render[moduleFilePath as string as SourcePath];
    return at === undefined
      ? { status: "no-render-at-path" }
      : { status: "rendered", render: at };
  }
}
