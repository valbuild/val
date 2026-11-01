import {
  Internal,
  type ModuleFilePath,
  type SelectorSource,
  type SourcePath,
  type ValConfig,
  type ValModule,
  type ValModules,
} from "@valbuild/core";
import { createValClient } from "@valbuild/shared/internal";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryPatchStore,
  initValContent,
  initValServer,
} from "@valbuild/tanstack/server";
import {
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
import { SchemaValidator } from "../../../packages/ui/spa/validation/validateModule";
import type { System } from "../../../packages/ui/spa/stores/createSystem";
import { createNetwork, type Network } from "./network";
import { inRequest } from "./tanstackStart";
import { createFrames, type Frames } from "./frames";
import { startFakeClock, type Clock } from "./clock";

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
  deployCode(modules: AnyModule[]): void;
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
  /** What a string field writes when typing pauses, through the same path. */
  edit(module: AnyModule, fieldPath: string[], value: string): Promise<void>;
  /** The Studio's `/stat` poll: what it last took in. */
  readonly stat: StatState;
  /**
   * New code reaches the Studio: what `ValStoreProvider` does when the app's
   * `<ValModulesClient>` registers a new registry (`val-modules-updated`):
   * `loadValModules`, then `HostStore.receive`.
   */
  receiveCode(modules: AnyModule[]): Promise<void>;
  /** The messages the Studio is showing the editor (`StatusStore`). */
  errors(): string[];
  /** A surface: the Studio's own value at a field, as a field reads it. */
  reads(surface: string, module: AnyModule, fieldPath: string[]): void;
};

export type Page = {
  route: string;
  /** A surface: something the page reads on the server (a loader). */
  reads(surface: string, read: (val: PageReaders) => Promise<unknown>): void;
};

export type PageReaders = {
  /** The real `fetchVal` of `@valbuild/tanstack/server`, with edit tags removed. */
  fetchVal<T extends Resolvable>(module: T): Promise<DecodeVal<ResolvedVal<T>>>;
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

function hostFor(mode: ServerMode): ServerHost {
  if (mode === "memory") {
    return {
      mode,
      sourceFiles: {},
      patchStore: new InMemoryPatchStore(),
      unsafelyAllowUnauthenticated: true,
    };
  }
  const root = mkdtempSync(join(tmpdir(), "val-scenario-"));
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
  const host = hostFor(options.server);
  const apiDraftMode = { on: true };
  const serverFor = (registry: ValModules) =>
    initValServer(registry, options.config, {
      ...hostOptions(host),
      draftMode: draftModeOf(apiDraftMode),
    }).valApiHandler;
  const network = createNetwork(serverFor(valModules));
  const pages: Array<() => void> = [];
  const deployCode = (modules: AnyModule[]) => {
    valModules = registryOf(modules);
    network.route(serverFor(valModules));
    for (const reload of pages) reload();
  };
  const frames = createFrames();
  const surfaces: Array<{ name: string; read: () => Promise<unknown> }> = [];
  const clock = startFakeClock();
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

  return {
    server:
      host.mode === "fs" ? { mode: "fs", root: host.root } : { mode: "memory" },
    network,
    frames,
    async studio(name) {
      const client = createValClient("/api/val", null, {
        fetch: network.fetchFor(`studio:${name}`),
      });
      const validator = new SchemaValidator();
      const system = createValSystem(client, {
        writes: true,
        mode: "fs",
        schemaValidation: {
          validate: async (moduleFilePath, source, serializedSchema, version) =>
            validator.validate(
              moduleFilePath,
              source,
              serializedSchema,
              version,
            ),
        },
      });
      // Intake, then /stat: the order `ValStoreProvider` uses.
      system.host.receive(await loadValModules(valModules));

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
        },
        get stat() {
          return stat;
        },
        async receiveCode(modules) {
          system.host.receive(await loadValModules(registryOf(modules)));
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
      for (const { stop } of studios) stop();
      // A parked long poll ends when the server's own interval runs out.
      await clock.advance(LONG_POLL_MS);
      await Promise.all(studios.map(({ polling }) => polling));
      clock.stop();
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

/** Where a field's edit goes: its module, and its patch path, as `useAddPatch` computes it. */
function patchTarget(
  module: AnyModule,
  fieldPath: string[],
): [ModuleFilePath, string[]] {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePathOf(module, fieldPath));
  return [moduleFilePath, Internal.createPatchPath(modulePath)];
}
