import {
  Internal,
  type Json,
  type ModuleFilePath,
  type PatchId,
  type ResolvableModule,
  type SelectorSource,
  type SourcePath,
  type ValConfig,
  type ValModule,
  type ValModules,
} from "@valbuild/core";
import { createValClient } from "@valbuild/shared/internal";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  InMemoryPatchStore,
  initValContent,
  initValServer,
} from "@valbuild/tanstack/server";
import {
  getModuleIds,
  raw,
  type DecodeVal,
  type Resolvable,
  type ResolvedVal,
} from "@valbuild/react/stega";
// The Studio's own code, by path: `@valbuild/ui` exports the built Studio,
// not its stores. Each of these is what the Studio runs, unchanged.
import { createValSystem } from "../../../packages/ui/spa/stores/react/createValSystem";
import { loadValModules } from "../../../packages/ui/spa/stores/react/loadValModules";
import { statSnapshotOf } from "../../../packages/ui/spa/stores/react/statSnapshotOf";
import {
  requestStat,
  statStateAfterAnswer,
  statWait,
  type StatState,
} from "../../../packages/ui/spa/hooks/useStatus";
import { stringFieldPatch } from "../../../packages/ui/spa/components/fields/stringFieldPatch";
import { writePatch } from "../../../packages/ui/spa/stores/react/writePatch";
import { directFileUploadSettings } from "../../../packages/ui/spa/stores/react/directFileUploadSettings";
import type { Patch } from "@valbuild/core/patch";
import { SchemaValidator } from "../../../packages/ui/spa/validation/validateModule";
import type { System } from "../../../packages/ui/spa/stores/createSystem";
import type { PublishResult } from "../../../packages/ui/spa/stores/PublishSeam";
import {
  RecordingActivity,
  type WorkKind,
} from "../../../packages/ui/spa/stores/activity";
import { createNetwork, type Handler, type Network } from "./network";
import {
  startOverlayRelay,
  type OverlayEvent,
} from "../../../packages/ui/spa/stores/react/sourceRelay";
// The page's own code, by path: TanStack's draft store and how `useVal`
// reads it, which the package does not export.
import {
  applyValEvent,
  createDraftStore,
  isDraft,
} from "../../../packages/tanstack/src/draftStore";
import {
  overlaySourceOf,
  readWithOverlay,
} from "../../../packages/tanstack/src/client/overlayRead";
import type { ValExternalStore } from "../../../packages/tanstack/src/ValOverlayContext";
import type { ValDraft } from "../../../packages/tanstack/src/ValDraft";
import {
  startRefreshLoop,
  type RefreshLoop,
} from "../../../packages/tanstack/src/refreshLoop";
import { inRequest } from "./tanstackStart";
import { createFrames, type Frames } from "./frames";
import { startFakeClock, type Clock } from "./clock";
import { installXmlHttpRequest } from "./xmlHttpRequest";

/**
 * A world a scenario runs in: Val's real server behind a network the test
 * controls, and Studios and pages that talk to it with their real code.
 *
 * The rule (`.agent/rules.md`, "A test drives the product's code"): every action
 * the world takes is a call to the function the product calls for it. Where
 * that function was buried in a component or a hook, it was extracted and the
 * product calls the extracted one too -- never a second copy here.
 */
export type World = {
  /** Which mode the server runs in, and for fs, the project directory. */
  server: { mode: "memory" } | { mode: "fs"; root: string };
  network: Network;
  frames: Frames;
  studio(name: string): Promise<Studio>;
  page(route: string, options: { draftMode: boolean }): Page;
  /** Every surface reads what it reads, and the answers become frames. */
  observe(): Promise<void>;
  /**
   * Let the world run until it is quiet: every Studio sends what it has not
   * saved, every poll that has news takes it, and time moves forward in steps
   * until nothing changes for a while. Parked long polls are quiet.
   */
  settle(): Promise<void>;
  /** The world's fake clock. See `clock.ts`. */
  clock: Clock;
  /**
   * New code reaches the app's server, as HMR does in development: the server
   * module is evaluated again, so `initValServer` and every page's
   * `initValContent` are called again with the new registry. Pending edits
   * stay where they are (fs: `.val/patches`; memory: the same patch store).
   */
  deployCode(modules: AnyModule[]): Deployment;
  /**
   * A page in the browser with the Val overlay on it (not inside the Studio),
   * loaded the way a TanStack page is: the server renders it from a
   * server-read draft (`fetchValDraft`, the `draft` prop), the browser
   * hydrates from the same draft, then the overlay's Studio starts from the
   * page's own client modules and the base the page serves, and relays what
   * it holds to the page's store. Every surface records a frame at each step
   * and at every store change, so a value that comes and goes is caught.
   */
  loadPage(route: string, options: PageLoadOptions): Promise<LoadedPage>;
  /** {@link deployCode}, then every Studio's {@link Studio.receiveCode}. */
  changeCode(modules: AnyModule[]): Promise<void>;
  /** The invariants every scenario is held to. See `frames.ts`. */
  expectInvariants(): void;
  /** Stops what the world started, and puts the working directory back. */
  dispose(): Promise<void>;
};

export type Studio = {
  name: string;
  system: System;
  /**
   * What a string field writes when typing pauses, through the same path.
   * Answers the new patch's id.
   */
  edit(module: AnyModule, fieldPath: string[], value: string): Promise<PatchId>;
  /**
   * Any patch, written the way a field writes it (`writePatch`, what
   * `useAddPatch` calls): one with `file` ops uploads its bytes first, through
   * the Studio's own upload (`XMLHttpRequest`, to where
   * `directFileUploadSettings` says). Answers the patch's id.
   */
  write(
    module: AnyModule,
    patch: Patch,
    fileType?: "image" | "file",
  ): Promise<PatchId>;
  /** Discard patches, as Review's "Discard" does (`System.discard`). */
  discard(patchIds: PatchId[]): ReturnType<System["discard"]>;
  /**
   * Publish, as the Publish button does (`System.publish`): every patch in
   * the chain when `patchIds` is not given.
   */
  publish(patchIds?: PatchId[]): Promise<PublishResult>;
  /** The Studio's `/stat` poll: what it last took in. */
  readonly stat: StatState;
  /**
   * New code reaches the Studio: what `ValStoreProvider` does when the app's
   * `<ValModulesClient>` registers a new registry (`val-modules-updated`):
   * `loadValModules`, then `HostStore.receive`.
   */
  receiveCode(modules: AnyModule[]): Promise<void>;
  /**
   * A registry reaches the Studio, as `<ValModulesClient>` registers one: for
   * a registry whose modules are not all plain (a `def` that rejects, as a
   * module whose code throws does). {@link receiveCode} is this, for modules.
   */
  receiveRegistry(registry: ValModules): Promise<void>;
  /** The messages the Studio is showing the editor (`StatusStore`). */
  errors(): string[];
  /** The work the Studio's stores record (`activity.ts`), counted. */
  work: RecordingActivity;
  /**
   * The work done since `since` (a `work.position()`), against a budget:
   * a failure lists every kind that went over, with its count.
   */
  expectWork(since: number, budget: WorkBudget): void;
  /** A surface: the Studio's own value at a field, as a field reads it. */
  reads(surface: string, module: AnyModule, fieldPath: string[]): void;
};

/** At most, or exactly, this many of a kind of work. */
export type WorkBudget = Partial<
  Record<WorkKind, { atMost: number } | { exactly: number }>
>;

export type Page = {
  route: string;
  /** A surface: something the page reads on the server (a loader). */
  reads(surface: string, read: (val: PageReaders) => Promise<unknown>): void;
};

/** What a deploy leaves behind: the build that answered until now, and the new one. */
export type Deployment = { previous: Handler; current: Handler };

export type PageLoadOptions = {
  /**
   * The modules the page's BROWSER bundle carries. The server's when not
   * given; an older set models a browser running the previous build's
   * client code (a cached `/_app/app.js`).
   */
  clientModules?: AnyModule[];
  /** What the page shows through `useVal`: a field of a module, each a surface. */
  shows: Array<{ surface: string; module: AnyModule; field: string[] }>;
  /**
   * What the page shows from its LOADERS: a field read on the server with
   * `fetchVal`, at the server render and again every time the page's refresh
   * loop (`startRefreshLoop`, as `ValTanStackProvider` runs it) re-runs them.
   */
  loaderShows?: Array<{ surface: string; module: AnyModule; field: string[] }>;
};

export type LoadedPage = {
  /** The overlay's Studio. */
  studio: Studio;
  /** Everything the overlay sent the page, in order. */
  events: OverlayEvent[];
  /** How many times the refresh loop has re-run the loaders. */
  readonly refreshes: number;
};

export type PageReaders = {
  /** The real `fetchVal` of `@valbuild/tanstack/server`, with edit tags removed. */
  fetchVal<T extends Resolvable>(module: T): Promise<DecodeVal<ResolvedVal<T>>>;
  /** The real `fetchValKey`: one `.jsonValues()` entry. Edit tags removed. */
  fetchValKey(module: ResolvableModule, key: string): Promise<unknown>;
};

type AnyModule = ValModule<SelectorSource>;

export type WorldOptions = {
  config: ValConfig;
  modules: AnyModule[];
  /**
   * Where pending edits live, as an app's server decides it:
   * - `memory`: the host holds the source and the patches (`sourceFiles`, a
   *   patch store passed to both `initValServer` and `initValContent`).
   * - `fs`: local development. The project is the working directory
   *   (`initHandlerOptions` reads `process.cwd()`), so the world makes a
   *   fresh temporary directory and works in it for its lifetime; patches
   *   land in its `.val/patches`, where both the API and the readers find
   *   them, as in an app.
   *
   * http needs the mock content host, and is not here yet.
   */
  server: ServerMode;
  /**
   * The `.val.ts` text of modules, for what reads it: a publish rewrites it.
   * Written into the project directory in fs mode and handed over as
   * `sourceFiles` in memory mode, as an app's host would.
   */
  sourceText?: Record<string, string>;
};

export type ServerMode = "memory" | "fs";

/** What an app passes to both `initValServer` and `initValContent` for a mode. */
type ServerHost =
  | {
      mode: "memory";
      sourceFiles: Record<string, string>;
      patchStore: InMemoryPatchStore;
      unsafelyAllowUnauthenticated: true;
    }
  | { mode: "fs"; root: string; restore: () => void };

function hostFor(
  mode: ServerMode,
  sourceText: Record<string, string>,
): ServerHost {
  if (mode === "memory") {
    return {
      mode,
      sourceFiles: Object.fromEntries(
        Object.entries(sourceText).map(([path, text]) => [
          path.replace(/^\//, ""),
          text,
        ]),
      ),
      patchStore: new InMemoryPatchStore(),
      unsafelyAllowUnauthenticated: true,
    };
  }
  const root = mkdtempSync(join(tmpdir(), "val-scenario-"));
  for (const [path, text] of Object.entries(sourceText)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const previous = process.cwd();
  process.chdir(root);
  return {
    mode,
    root,
    restore: () => {
      process.chdir(previous);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The options both server-side entry points get, for the host's mode. */
function hostOptions(host: ServerHost) {
  return host.mode === "memory"
    ? {
        sourceFiles: host.sourceFiles,
        patchStore: host.patchStore,
        unsafelyAllowUnauthenticated: host.unsafelyAllowUnauthenticated,
      }
    : {};
}

export async function createWorld(options: WorldOptions): Promise<World> {
  const registryOf = (modules: AnyModule[]): ValModules => ({
    config: options.config,
    modules: modules.map((module) => ({
      def: () => Promise.resolve({ default: module }),
    })),
  });
  let valModules = registryOf(options.modules);
  // One place for pending edits, shared by the API and the readers -- as an
  // app passes the same options to `initValServer` and `initValContent`.
  const host = hostFor(options.server, options.sourceText ?? {});
  const apiDraftMode = { on: true };
  const serverFor = (registry: ValModules) =>
    initValServer(registry, options.config, {
      ...hostOptions(host),
      draftMode: draftModeOf(apiDraftMode),
    }).valApiHandler;
  let serverModules = options.modules;
  let currentHandler = serverFor(valModules);
  const network = createNetwork(currentHandler);
  let builds = 1;
  network.name(currentHandler, `build ${builds}`);
  const pages: Array<() => void> = [];
  const deployCode = (modules: AnyModule[]): Deployment => {
    serverModules = modules;
    valModules = registryOf(modules);
    const previous = currentHandler;
    currentHandler = serverFor(valModules);
    network.name(currentHandler, `build ${++builds}`);
    network.route(currentHandler);
    for (const reload of pages) reload();
    return { previous, current: currentHandler };
  };
  /** The readers a page's server uses, for the server's current code. */
  const readersFor = (draft: { on: boolean }) =>
    initValContent(options.config, valModules, {
      ...hostOptions(host),
      draftMode: draftModeOf(draft),
    });
  const relays: Array<() => void> = [];
  const refreshLoops: RefreshLoop[] = [];
  const frames = createFrames();
  const surfaces: Array<{ name: string; read: () => Promise<unknown> }> = [];
  const clock = startFakeClock();
  // The browser's upload: through the same network as everything else.
  const uninstallXhr = installXmlHttpRequest(network.fetchFor("browser:xhr"));
  const studios: Array<{
    studio: Studio;
    stop: () => void;
    polling: Promise<void>;
  }> = [];

  /** What has to stay the same for the world to count as quiet. */
  const signature = () =>
    JSON.stringify([
      network.log.map((exchange) => exchange.status),
      studios.map(({ studio }) => [
        "data" in studio.stat ? studio.stat.data?.patches : null,
        studio.system.patchSync.currentState().status,
      ]),
    ]);

  /**
   * A Studio, as `ValStoreProvider` starts one: a system on the real client,
   * the modules in (with the base the page serves, when it serves one), then
   * the /stat poll. `beforeIntake` runs what mounts beside the provider, such
   * as the overlay's relay.
   */
  const startStudio = async (
    name: string,
    registry: ValModules,
    options: {
      base?: Record<ModuleFilePath, Json>;
      beforeIntake?: (system: System) => void;
    } = {},
  ): Promise<Studio> => {
    const client = createValClient("/api/val", null, {
      fetch: network.fetchFor(`studio:${name}`),
    });
    const validator = new SchemaValidator();
    let seq = 0;
    const work = new RecordingActivity(() => ++seq);
    const system = createValSystem(client, {
      activity: work,
      writes: true,
      mode: "fs",
      uploadSettings: () => directFileUploadSettings(client),
      schemaValidation: {
        validate: async (moduleFilePath, source, serializedSchema, version) =>
          validator.validate(moduleFilePath, source, serializedSchema, version),
      },
    });
    options.beforeIntake?.(system);
    // Intake, then /stat: the order `ValStoreProvider` uses. With the base the
    // page serves, where it is not the bundle's (`window.__VAL_BASE__`).
    system.host.receive(await loadValModules(registry), options.base);

    // The Studio's /stat poll: what is asked (`requestStat`), what an answer
    // does to it (`statStateAfterAnswer`) and when it asks again
    // (`statWait`) are the hook's own functions; the answer reaches the
    // stores through `statSnapshotOf`, as `ValStoreProvider` hands it on.
    // What is left here is only the loop that strings them together, which
    // in the Studio is a React effect. No socket: fs and memory long-poll.
    let stat: StatState = { status: "not-asked" };
    let stopped = false;
    const ask = async () => {
      const res = await requestStat(client, stat);
      const next = statStateAfterAnswer(stat, res, false, Date.now());
      if (next === null) {
        throw new Error(`/stat answered ${res.status}`);
      }
      stat = next;
      if ("data" in stat && stat.data) {
        system.stat.receiveStat(statSnapshotOf(stat.data));
      }
    };
    await ask();
    const polling = (async () => {
      while (!stopped) {
        const wait = statWait(stat, false, Date.now());
        if (wait === null) return;
        if (wait > 0) {
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        if (stopped) return;
        try {
          await ask();
        } catch (error) {
          if (!stopped) throw error;
        }
      }
    })();

    const studio: Studio = {
      name,
      system,
      async edit(module, fieldPath, value) {
        const [moduleFilePath, patchPath] = patchTarget(module, fieldPath);
        // What `useAddPatch` does for a field: the same call, the same
        // arguments, minus the field instance's id.
        const res = await system.patchStore.createPatch(
          moduleFilePath,
          stringFieldPatch(patchPath, value),
        );
        if (res.status !== "created") {
          throw new Error(`The edit was refused: ${res.message}`);
        }
        return res.record.patchId;
      },
      async write(module, patch, fileType) {
        const res = await writePatch(system, moduleFilePathOf(module), patch, {
          ...(fileType !== undefined ? { fileType } : {}),
        });
        if (res.status === "error") {
          throw new Error(`The patch was refused: ${res.message}`);
        }
        return res.patchId;
      },
      discard(patchIds) {
        return system.discard(patchIds);
      },
      publish(patchIds) {
        return system.publish(
          patchIds ??
            system.patchStore.allRecords().map((record) => record.patchId),
        );
      },
      get stat() {
        return stat;
      },
      async receiveCode(modules) {
        system.host.receive(await loadValModules(registryOf(modules)));
      },
      async receiveRegistry(registry) {
        system.host.receive(await loadValModules(registry));
      },
      work,
      expectWork(since, budget) {
        const over: string[] = [];
        for (const [kind, limit] of Object.entries(budget)) {
          if (limit === undefined || !isWorkKind(kind)) continue;
          const count = work.count(kind, { since });
          const ok =
            "atMost" in limit ? count <= limit.atMost : count === limit.exactly;
          if (!ok) {
            over.push(
              `  ${kind}: ${count} (budget ${"atMost" in limit ? `at most ${limit.atMost}` : `exactly ${limit.exactly}`})`,
            );
          }
        }
        if (over.length > 0) {
          throw new Error(
            `✕ work over budget in studio "${name}":\n${over.join("\n")}\nAll work since: ${JSON.stringify(work.summary(since))}`,
          );
        }
      },
      errors() {
        return system.status.current().errors.map((error) => error.message);
      },
      reads(surface, module, fieldPath) {
        const path = sourcePathOf(module, fieldPath);
        surfaces.push({
          name: surface,
          read: async () => {
            const read = await system.sourceStore.get(path, null);
            return "data" in read ? read.data : `(${read.status})`;
          },
        });
      },
    };
    studios.push({
      studio,
      stop: () => {
        stopped = true;
      },
      polling,
    });
    return studio;
  };

  return {
    server:
      host.mode === "fs" ? { mode: "fs", root: host.root } : { mode: "memory" },
    network,
    frames,
    studio: (name) => startStudio(name, valModules),
    async loadPage(route, pageOptions) {
      const request = () =>
        new Request(new URL(route, "http://localhost").href);
      const clientModules = pageOptions.clientModules ?? serverModules;
      const record = (
        modules: AnyModule[],
        sourceOf: (moduleId: string) => Json | undefined,
      ) => {
        for (const show of pageOptions.shows) {
          frames.record(
            show.surface,
            readField(moduleLike(modules, show.module), show.field, sourceOf),
          );
        }
        frames.tick();
      };
      // 1. The server renders the page: the layout's loader reads the draft
      //    (`fetchValDraft`) and the provider seeds its store from it.
      const draft = await inRequest(request(), () =>
        readersFor({ on: true }).fetchValDraft(),
      );
      const serverStore = createDraftStore(draft);
      const read = (store: ValExternalStore, modules: AnyModule[]) =>
        record(modules, (moduleId) =>
          overlaySourceOf(
            store.get(idsOf(modules)),
            isDraft(draft) ? true : null,
            draft?.snapshot,
          )(moduleId),
        );
      read(serverStore, serverModules);
      // The page's loaders, read on the server: at the server render, and
      // whenever the refresh loop re-runs them. One `initValContent` per page
      // server, made again on a deploy, as the server module is.
      let content = readersFor({ on: true });
      pages.push(() => {
        content = readersFor({ on: true });
      });
      const readLoaders = async () => {
        for (const show of pageOptions.loaderShows ?? []) {
          const value: unknown = await inRequest(request(), async () =>
            raw(await content.fetchValStega(show.module)),
          );
          frames.record(show.surface, fieldOf(value, show.field));
        }
        if ((pageOptions.loaderShows ?? []).length > 0) frames.tick();
      };
      await readLoaders();
      // 2. The browser hydrates from the same draft, as loader data -- which
      //    is JSON on the way -- with its own client modules.
      const loaderData: ValDraft | null =
        draft === null ? null : JSON.parse(JSON.stringify(draft));
      const pageStore = createDraftStore(loaderData);
      read(pageStore, clientModules);
      // 3. The overlay mounts: its Studio takes in the page's client modules
      //    with the base the page serves (`window.__VAL_BASE__`), and its
      //    relay hands the page's store what the Studio holds.
      const events: OverlayEvent[] = [];
      // The provider's refresh loop: an edit landing in the page's store
      // re-runs the loaders, at most every 500 ms, with the safety net behind.
      const pending = { current: 0 };
      let refreshing = false;
      let refreshes = 0;
      const loop = startRefreshLoop({
        pending,
        refresh: () => {
          refreshing = true;
          refreshes++;
          void readLoaders().finally(() => {
            refreshing = false;
          });
        },
        isRefreshing: () => refreshing,
        isHidden: () => false,
      });
      refreshLoops.push(loop);
      const studio = await startStudio(
        `overlay ${route}`,
        registryOf(clientModules),
        {
          base: isDraft(loaderData) ? loaderData.base : undefined,
          beforeIntake: (system) => {
            relays.push(
              startOverlayRelay(system, (event) => {
                events.push(event);
                const outcome = applyValEvent(pageStore, event);
                if (outcome.type === "updated" && outcome.changed) {
                  read(pageStore, clientModules);
                  // Where the provider counts an edit and fires
                  // VAL_EDIT_LANDED, which its loop listens for.
                  pending.current++;
                  loop.editLanded();
                }
              }),
            );
          },
        },
      );
      return {
        studio,
        events,
        get refreshes() {
          return refreshes;
        },
      };
    },
    page(route, pageOptions) {
      const draft = { on: pageOptions.draftMode };
      const contentFor = (registry: ValModules) =>
        initValContent(options.config, registry, {
          ...hostOptions(host),
          draftMode: draftModeOf(draft),
        });
      let content = contentFor(valModules);
      pages.push(() => {
        content = contentFor(valModules);
      });
      const readers: PageReaders = {
        async fetchVal(module) {
          return raw(await content.fetchValStega(module));
        },
        async fetchValKey(module, key) {
          return raw(await content.fetchValKeyStega(module, key));
        },
      };
      return {
        route,
        reads(surface, read) {
          surfaces.push({
            name: surface,
            read: () =>
              inRequest(
                new Request(new URL(route, "http://localhost").href),
                () => read(readers),
              ),
          });
        },
      };
    },
    async observe() {
      for (const surface of surfaces) {
        frames.record(surface.name, await surface.read());
      }
      frames.tick();
    },
    expectInvariants() {
      frames.expectInvariants();
    },
    clock,
    deployCode,
    async changeCode(modules) {
      deployCode(modules);
      for (const { studio } of studios) {
        await studio.receiveCode(modules);
      }
    },
    async settle() {
      let quiet = 0;
      for (let round = 0; round < SETTLE_MAX_ROUNDS; round++) {
        const before = signature();
        // What the save loop does by itself after an edit; started rather
        // than awaited, because a retry waits on the clock this loop moves.
        for (const { studio } of studios) {
          void studio.system.patchSync.flush();
        }
        await clock.advance(SETTLE_STEP_MS);
        quiet = signature() === before ? quiet + 1 : 0;
        if (quiet >= SETTLE_QUIET_ROUNDS) return;
      }
      throw new Error(
        `The world did not settle in ${(SETTLE_MAX_ROUNDS * SETTLE_STEP_MS) / 1000}s of its time. Last requests:\n${network.log
          .slice(-10)
          .map((e) => `  ${e.from} ${e.method} ${e.path} ${e.status}`)
          .join("\n")}`,
      );
    },
    async dispose() {
      for (const stop of relays) stop();
      for (const loop of refreshLoops) loop.stop();
      for (const { stop } of studios) stop();
      // A parked long poll ends when the server's own interval runs out.
      await clock.advance(LONG_POLL_MS);
      await Promise.all(studios.map(({ polling }) => polling));
      clock.stop();
      uninstallXhr();
      if (host.mode === "fs") host.restore();
    },
  };
}

/** One step of `settle`: longer than fs mode's 250 ms look at the patch log. */
const SETTLE_STEP_MS = 300;
/** Quiet for this many steps in a row is quiet. */
const SETTLE_QUIET_ROUNDS = 3;
/** A minute of the world's time, past which something is spinning. */
const SETTLE_MAX_ROUNDS = 200;
/** The server's long poll, plus a margin (`ValOpsFS` / `ValOpsMemory`). */
const LONG_POLL_MS = 21_000;

/** Narrows a budget's key, which `Object.entries` widens to string. */
function isWorkKind(kind: string): kind is WorkKind {
  return kind.includes(":");
}

function draftModeOf(flag: { on: boolean }) {
  return {
    isEnabled: async () => flag.on,
    enable: async () => {
      flag.on = true;
    },
    disable: async () => {
      flag.on = false;
    },
  };
}

/** The module ids a read needs, as `useValStega` subscribes to them. */
function idsOf(modules: AnyModule[]): ModuleFilePath[] {
  const ids = new Set<ModuleFilePath>();
  for (const module of modules) {
    for (const id of getModuleIds(module)) {
      ids.add(id as ModuleFilePath);
    }
  }
  return [...ids];
}

/** The module in `modules` with the same path as `module`: the same module in another build. */
function moduleLike(modules: AnyModule[], module: AnyModule): AnyModule {
  const path = Internal.getValPath(module);
  const found = modules.find((m) => Internal.getValPath(m) === path);
  if (found === undefined) {
    throw new Error(`No module at ${String(path)} in this build`);
  }
  return found;
}

/** A field of what `useVal` gives back, read the way the hook reads it. */
function readField(
  module: AnyModule,
  field: string[],
  sourceOf: (moduleId: string) => Json | undefined,
): unknown {
  return fieldOf(raw(readWithOverlay(module, sourceOf, null, false)), field);
}

/** A field of a value read through a reader. */
function fieldOf(read: unknown, field: string[]): unknown {
  let value = read;
  for (const key of field) {
    value =
      typeof value === "object" && value !== null
        ? Object.entries(value).find(([k]) => k === key)?.[1]
        : undefined;
  }
  return value;
}

/** The source path of a field, built the way a module's fields are walked. */
function sourcePathOf(module: AnyModule, fieldPath: string[]): SourcePath {
  let path = Internal.getValPath(module);
  for (const key of fieldPath) {
    path = Internal.createValPathOfItem(path, key);
  }
  if (path === undefined) {
    throw new Error(
      `No source path for ${fieldPath.join(".")}: is the module defined with c.define?`,
    );
  }
  return path;
}

/** A module's file path. */
function moduleFilePathOf(module: AnyModule): ModuleFilePath {
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
    sourcePathOf(module, []),
  );
  return moduleFilePath;
}

/** Where a field's edit goes: its module, and its patch path, as `useAddPatch` computes it. */
function patchTarget(
  module: AnyModule,
  fieldPath: string[],
): [ModuleFilePath, string[]] {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePathOf(module, fieldPath));
  return [moduleFilePath, Internal.createPatchPath(modulePath)];
}
