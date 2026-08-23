import {
  Internal,
  type ModuleFilePath,
  type SelectorSource,
  type SourcePath,
  type ValModule,
  type ValModules,
  initVal,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import type { ValClient } from "@valbuild/shared/internal";
import { ValSyncEngine } from "../ValSyncEngine";
import { createSystem, type System } from "../stores/createSystem";
import type { Revision } from "../stores/types";

/**
 * # The fairness contract
 *
 * A benchmark between two architectures is worthless unless what it asks of each
 * is genuinely the same question. The two systems are shaped differently on
 * purpose, so "call the equivalent method" does not exist:
 *
 * - `ValSyncEngine.getSourceSnapshot(module)` is per MODULE and deep-clones the
 *   whole module. `SourceStore.get(path, revision)` is per PATH and clones
 *   nothing.
 * - The engine is EAGER: `addPatch` applies the patch and kicks validation,
 *   renders and patch sets before it returns. The stores are LAZY: a patch marks,
 *   and the following read computes.
 *
 * Measuring only `addPatch` versus only `createPatch` would therefore be a rigged
 * comparison in the stores' favour — it would time the eager system doing all the
 * work and the lazy system doing none of it. Measuring only the reads would rig it
 * the other way.
 *
 * **So the unit of measurement is a FIELD BECOMING READY.** Every scenario runs
 * from "the keystroke is issued" to "every mounted field has, in hand, the three
 * things it needs to paint: the source at its path, the validation errors for its
 * module, and the render at its path (where there is one)." That is what the user
 * waits for, it is well-defined for both systems, and neither can win it by
 * deferring work to after the stopwatch stops.
 *
 * Two further rules, so the numbers mean what they look like:
 *
 * 1. **Both systems get their modules the same way** — locally, from the same
 *    generated `ValModule[]`, with no network in either. The engine's
 *    `setValModules` is its local-modules path (dev/fs mode) and is the closest
 *    thing to `HostStore.receive`. Nothing here measures HTTP, because HTTP is
 *    the same server for both and would only add noise.
 * 2. **`select` invocations are counted alongside the duration.** A system can
 *    be faster because it is better or because it did less; only the count
 *    separates those, and "did less" is a legitimate win ONLY if the field still
 *    got what it needed — which rule above enforces.
 *
 * ## What is NOT measured, and would flatter the stores if it were
 *
 * `PUT /patches` is unwired in the stores, so no scenario includes syncing a
 * patch to a server. The engine does that work and the stores do not. Every
 * scenario below therefore stops before the sync, and the engine is not charged
 * for it.
 */

export type DriverReads = {
  /** Fields that got source, validation and render. Guards against no-ops. */
  fieldsReady: number;
};

export type Driver = {
  name: string;
  /** Adopt the project. Timed as the intake scenario. */
  setup(modules: ValModule<SelectorSource>[]): Promise<void>;
  /** Register interest in these paths, as a mounting field does. */
  mount(paths: string[]): Promise<void>;
  /** One keystroke into one field. */
  type(module: string, path: string, value: string): Promise<void>;
  /** Everything every mounted field needs in order to paint. */
  readAll(): Promise<DriverReads>;
  /** Everything ONE field needs, for the single-field latency scenario. */
  readOne(module: string, path: string): Promise<DriverReads>;
  dispose(): void;
};

// --------------------------------------------------------------------------
// the engine being replaced
// --------------------------------------------------------------------------

/**
 * `ValSyncEngine` needs a `ValClient`. The local-modules path does not call it,
 * so this one exists to satisfy the constructor and to FAIL LOUDLY if a scenario
 * accidentally takes a network path — a silent 0ms from a stubbed request would
 * be the easiest way to publish a wrong number.
 */
const refusingClient: ValClient = async (route, method) => {
  throw new Error(
    `The benchmark took a network path it should not have: ${String(method)} ` +
      `${String(route)}. Both systems are driven from local modules only.`,
  );
};

export function engineDriver(): Driver {
  const { config } = initVal();
  const engine = new ValSyncEngine(refusingClient, undefined, undefined);
  let mounted: string[] = [];
  let now = 0;
  const unsubscribes: (() => void)[] = [];

  return {
    name: "ValSyncEngine",
    async setup(modules) {
      const valModules: ValModules = {
        config,
        modules: modules.map((module) => ({
          def: () => Promise.resolve({ default: module }),
        })),
      };
      await engine.setValModules(valModules);
    },
    async mount(paths) {
      mounted = paths;
      // The engine's subscription is per module, which is itself part of what is
      // being measured — so subscribe once per distinct module, which is the most
      // favourable reading of its API rather than one subscription per field.
      const modules = new Set(
        paths.map((path) => path.split("?p=")[0] as ModuleFilePath),
      );
      for (const moduleFilePath of modules) {
        unsubscribes.push(engine.subscribe("source", moduleFilePath)(() => {}));
      }
    },
    async type(module, path, value) {
      const patch: Patch = [{ op: "replace", path: patchPathOf(path), value }];
      engine.addPatch(path as SourcePath, "string", patch, ++now);
    },
    async readAll() {
      let fieldsReady = 0;
      for (const path of mounted) {
        if (readEngineField(engine, path)) fieldsReady++;
      }
      return { fieldsReady };
    },
    async readOne(_module, path) {
      return { fieldsReady: readEngineField(engine, path) ? 1 : 0 };
    },
    dispose() {
      for (const off of unsubscribes) off();
    },
  };
}

/**
 * A source path's module path, as the segment array a patch op wants.
 *
 * Via `splitModulePath` rather than by splitting on dots: a module path is a
 * quoted, dot-joined encoding (`?p=0."title"`), so anything simpler gets a key
 * containing a dot or a quote wrong — and gets an array index wrong too, since a
 * naive parse yields the string `"0"` where the ops want `0`.
 */
function patchPathOf(path: string): string[] {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    path as SourcePath,
  );
  return modulePath === ""
    ? []
    : Internal.splitModulePath(modulePath).map(String);
}

function readEngineField(engine: ValSyncEngine, path: string): boolean {
  const moduleFilePath = path.split("?p=")[0] as ModuleFilePath;
  const source = engine.getSourceSnapshot(moduleFilePath);
  // A field needs all three before it can paint. The finest API the engine
  // offers for each: source and render are per MODULE, validation is per path.
  engine.getRenderSnapshot(moduleFilePath);
  // Deliberately the per-path getter rather than `getAllValidationErrorsSnapshot`,
  // so this reads as what a field asks for. It costs the same — the per-path
  // getter delegates to the whole-project one, which is cached but invalidated
  // by every patch, so the first read after a keystroke rebuilds errors for the
  // entire project. That is the engine's behaviour, not a choice made here, and
  // it is a large part of why a keystroke costs what it costs.
  engine.getValidationErrorSnapshot(path as SourcePath);
  return source.status === "success";
}

// --------------------------------------------------------------------------
// the new stores
// --------------------------------------------------------------------------

export function storesDriver(): Driver {
  const system: System = createSystem({
    fetchPatches: async () => {
      throw new Error(
        "The benchmark took a network path it should not have: GET /patches.",
      );
    },
    createPatchId: (() => {
      let next = 0;
      return () => `bench-${++next}` as never;
    })(),
  });
  let mounted: string[] = [];
  const revisions = new Map<string, Revision>();
  const unsubscribes: (() => void)[] = [];

  return {
    name: "stores",
    async setup(modules) {
      system.host.receive(modules);
    },
    async mount(paths) {
      mounted = paths;
      paths.forEach((path, index) => {
        unsubscribes.push(
          system.sourceStore.addListener(
            path as SourcePath,
            `bench-field-${index}`,
            () => {},
          ),
        );
      });
    },
    async type(module, path, value) {
      await system.patchStore.createPatch(
        module as ModuleFilePath,
        [{ op: "replace", path: patchPathOf(path), value }],
        undefined,
        // The typed field's own id, so suppression is exercised rather than
        // bypassed — the engine has no equivalent, and pretending otherwise
        // would hide the cost of the mechanism.
        "bench-field-0",
      );
    },
    async readAll() {
      let fieldsReady = 0;
      for (const path of mounted) {
        if (await readStoresField(system, revisions, path)) fieldsReady++;
      }
      return { fieldsReady };
    },
    async readOne(_module, path) {
      return {
        fieldsReady: (await readStoresField(system, revisions, path)) ? 1 : 0,
      };
    },
    dispose() {
      for (const off of unsubscribes) off();
      system.dispose();
    },
  };
}

async function readStoresField(
  system: System,
  revisions: Map<string, Revision>,
  path: string,
): Promise<boolean> {
  const moduleFilePath = path.split("?p=")[0] as ModuleFilePath;
  const held = revisions.get(path) ?? null;
  const read = await system.sourceStore.get(path as SourcePath, held);
  if (read.status === "resolved-head" || read.status === "unchanged") {
    revisions.set(path, read.revision);
  }
  await system.validationStore.validate(moduleFilePath);
  await system.renderStore.get(path as SourcePath);
  // `unchanged` counts as ready: it means the field already holds the right
  // value, which is the cheap path the protocol exists to provide. Excluding it
  // would charge the stores for their own optimisation.
  return read.status === "resolved-head" || read.status === "unchanged";
}
