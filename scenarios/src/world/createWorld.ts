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
import { statRequestBody } from "../../../packages/ui/spa/hooks/useStatus";
import { stringFieldPatch } from "../../../packages/ui/spa/components/fields/stringFieldPatch";
import { SchemaValidator } from "../../../packages/ui/spa/validation/validateModule";
import type { System } from "../../../packages/ui/spa/stores/createSystem";
import { createNetwork, type Network } from "./network";
import { inRequest } from "./tanstackStart";
import { createFrames, type Frames } from "./frames";

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
  network: Network;
  frames: Frames;
  studio(name: string): Promise<Studio>;
  page(route: string, options: { draftMode: boolean }): Page;
  /** Every surface reads what it reads, and the answers become frames. */
  observe(): Promise<void>;
  /** The invariants every scenario is held to. See `frames.ts`. */
  expectInvariants(): void;
};

export type Studio = {
  name: string;
  system: System;
  /** What a string field writes when typing pauses, through the same path. */
  edit(module: AnyModule, fieldPath: string[], value: string): Promise<void>;
  /** Send everything unsaved and wait until the server has it. */
  settle(): Promise<void>;
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
  /** Only memory for now. fs is next; http needs the mock content host. */
  server: "memory";
};

export async function createWorld(options: WorldOptions): Promise<World> {
  const valModules: ValModules = {
    config: options.config,
    modules: options.modules.map((module) => ({
      def: () => Promise.resolve({ default: module }),
    })),
  };
  // One store of pending edits, shared by the API and the readers -- as an app
  // passes the same one to `initValServer` and `initValContent`.
  const patchStore = new InMemoryPatchStore();
  const apiDraftMode = { on: true };
  const { valApiHandler } = initValServer(valModules, options.config, {
    sourceFiles: {},
    patchStore,
    unsafelyAllowUnauthenticated: true,
    draftMode: draftModeOf(apiDraftMode),
  });
  const network = createNetwork(valApiHandler);
  const frames = createFrames();
  const surfaces: Array<{ name: string; read: () => Promise<unknown> }> = [];

  return {
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
      const stat = await client("/stat", "POST", {
        body: statRequestBody(undefined),
      });
      if (stat.status !== 200 || !("baseSha" in stat.json)) {
        throw new Error(`/stat answered ${stat.status}`);
      }
      system.stat.receiveStat(statSnapshotOf(stat.json));

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
        async settle() {
          await system.patchSync.flush();
          await network.idle();
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
      return studio;
    },
    page(route, pageOptions) {
      const draft = { on: pageOptions.draftMode };
      const content = initValContent(options.config, valModules, {
        sourceFiles: {},
        patchStore,
        unsafelyAllowUnauthenticated: true,
        draftMode: draftModeOf(draft),
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
  };
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
