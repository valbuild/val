import type { ModuleFilePath, ReifiedRender, SourcePath } from "@valbuild/core";
import { Internal } from "@valbuild/core";
import { StoreBus } from "./StoreBus";
import type { SystemEvent } from "./types";
import type { HostBridge } from "./bridges";
import type { SourceStore } from "./SourceStore";
import type { SchemaStore } from "./SchemaStore";

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

  constructor(
    private readonly host: HostBridge,
    private readonly sourceStore: SourceStore,
    private readonly schemaStore: SchemaStore,
  ) {}

  /**
   * A render is a function of (schema, source), so both invalidate it. Missing
   * the schema half is how an HMR edit leaves a stale render on screen.
   */
  listenTo(): () => void {
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
      await this.refresh(moduleFilePath);
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
