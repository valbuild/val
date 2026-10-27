import {
  Internal,
  type ModuleFilePath,
  type SelectorSource,
  type SourcePath,
  type ValModule,
} from "@valbuild/core";
import { createSystem, type System } from "../stores/createSystem";
import type { Revision } from "../stores/types";

/**
 * # What the benchmark measures, and why the unit is what it is
 *
 * This began as a comparison against `ValSyncEngine`, and the contract it was
 * written under is worth keeping now that the engine is gone — because it is
 * what makes the remaining numbers mean anything at all, and because it is the
 * contract any future comparison has to be held to.
 *
 * The two systems were shaped differently on purpose, so "call the equivalent
 * method" did not exist. The engine's `getSourceSnapshot(module)` was per MODULE
 * and deep-cloned the whole module; `SourceStore.get(path, revision)` is per
 * PATH and clones nothing. The engine was EAGER — `addPatch` applied the patch
 * and kicked validation, previews and patch sets before returning — and the
 * stores are LAZY: a patch marks, and the following read computes.
 *
 * Timing `addPatch` against `createPatch` would therefore have been rigged in
 * the stores' favour: it would time the eager system doing all the work and the
 * lazy system doing none of it. Timing only the reads would rig it the other
 * way.
 *
 * **So the unit of measurement is a FIELD BECOMING READY.** Every scenario runs
 * from "the keystroke is issued" to "every mounted field has, in hand, the three
 * things it needs to paint: the source at its path, the validation errors for its
 * module, and the preview at its path (where there is one)." That is what the user
 * waits for, and nothing can win it by deferring work past the stopwatch.
 *
 * Two rules follow, and they still bind:
 *
 * 1. **Modules come from local `ValModule[]`, never over HTTP.** The injected
 *    client throws, so a scenario that takes a network path fails loudly rather
 *    than reporting a suspiciously fast 0ms.
 * 2. **`select` invocations are counted alongside every duration.** A system can
 *    be faster because it is better or because it did less; only the count
 *    separates those, and "did less" is legitimate ONLY if the field still got
 *    what it needed — which the rule above enforces.
 *
 * ## What is NOT measured
 *
 * `PUT /patches`. No scenario syncs a patch to a server, so nothing here is a
 * measurement of the write path — that is what `e2e/studio.spec.ts` covers,
 * against a real one.
 */

export type DriverReads = {
  /** Fields that got source, validation and preview. Guards against no-ops. */
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
  await system.previewStore.get(path as SourcePath);
  // `unchanged` counts as ready: it means the field already holds the right
  // value, which is the cheap path the protocol exists to provide. Excluding it
  // would charge the stores for their own optimisation.
  return read.status === "resolved-head" || read.status === "unchanged";
}
