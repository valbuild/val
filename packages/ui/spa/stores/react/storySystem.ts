import type {
  Json,
  ModuleFilePath,
  ReifiedRender,
  SerializedSchema,
} from "@valbuild/core";
import { createSystem, type System } from "../createSystem";
import type { HostBridge } from "../bridges";

/**
 * A store system fed from static mock data, for Storybook.
 *
 * ## Why a `HostBridge` rather than `host.receive`
 *
 * Intake takes real `ValModule` instances and derives schema, source and renders
 * from them. A story has none: it has serialized schemas, plain JSON sources and
 * hand-written renders, which is the point — a story is meant to pin one visual
 * state, not to evaluate a project.
 *
 * So the stores are fed directly (`schemaStore.receive`, `sourceStore.receive`)
 * and the render/validate seam is answered by a bridge that returns the story's
 * renders. `HostBridge` is a seam, `HostStore` is one implementation of it, and
 * this is the second — the same shape of substitution `workerRealm` and
 * `schemaValidation` already have.
 *
 * ## What a story system deliberately cannot do
 *
 * Write. No `savePatches`, no `publishPatches`, no `uploadFile`, so an edit made
 * in a story stays local and `PatchSync` reports it pending forever. That is the
 * honest behaviour — see `SystemOptions.savePatches` — and it is what a story
 * should do: a story that quietly POSTed somewhere would be a story nobody could
 * run offline.
 */
export function createStorySystem({
  schemas,
  sources,
  renders,
}: {
  schemas: Record<ModuleFilePath, SerializedSchema | undefined>;
  sources: Record<ModuleFilePath, Json | undefined>;
  renders?: Record<ModuleFilePath, ReifiedRender | null>;
}): System {
  const hostBridge: HostBridge = {
    async render(moduleFilePath) {
      const render = renders?.[moduleFilePath];
      return render === undefined || render === null
        ? { status: "unknown-module" }
        : { status: "rendered", render };
    },
    async customValidate() {
      // A story has no user closures to run — its schemas are already
      // serialized, and serializing is what strips them.
      return { status: "validated", errors: false };
    },
  };

  const system = createSystem({
    // Nothing announces patch ids in a story, so nothing ever asks for one.
    fetchPatches: async (patchIds) => ({
      patches: [],
      errors: Object.fromEntries(
        patchIds.map((patchId) => [patchId, "No server in Storybook"]),
      ),
    }),
    hostBridge,
  });

  const definedSchemas: Record<ModuleFilePath, SerializedSchema> = {};
  for (const [moduleFilePath, schema] of Object.entries(schemas)) {
    if (schema) definedSchemas[moduleFilePath as ModuleFilePath] = schema;
  }
  const definedSources: Record<ModuleFilePath, Json> = {};
  for (const [moduleFilePath, source] of Object.entries(sources)) {
    if (source !== undefined) {
      definedSources[moduleFilePath as ModuleFilePath] = source;
    }
  }
  /**
   * An intake of nothing, and it is load-bearing.
   *
   * Every read hook gates on `host.initializedAt()`, because before intake an
   * absent module means "not yet" and after it means "no such module" — and a
   * system that has never taken anything in reports `loading` for everything. A
   * story has no `ValModule`s to hand over, so it says the intake happened with
   * none, which is true: the story's content arrives through the two calls below
   * instead.
   *
   * Safe in this order: `SchemaStore.receive` and `SourceStore.receive` merge
   * rather than replace, so an intake of nothing overwrites nothing.
   */
  system.host.receive([]);
  // Schemas before sources: `SourceStore.peek` answers `module-loading` for a
  // module whose schema it does not have, so the other order would leave the
  // first read after setup reporting a spinner.
  system.schemaStore.receive(definedSchemas);
  system.sourceStore.receive(definedSources);
  return system;
}
