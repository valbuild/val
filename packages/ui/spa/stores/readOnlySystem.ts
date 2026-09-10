import type {
  Json,
  ModuleFilePath,
  ReifiedPreview,
  SerializedSchema,
} from "@valbuild/core";
import { createSystem, type System } from "./createSystem";
import type { FetchJsonEntry } from "./SourceStore";
import type { HostBridge } from "./bridges";

/**
 * A store system fed from data that is already schema + JSON, and cannot write.
 *
 * Two callers want exactly this and for the same reason: a Storybook story, and
 * the history pane showing a module as some commit left it. Neither has
 * `ValModule` instances to intake — intake evaluates a project, and both of
 * these have a serialized schema and plain JSON instead, which is the whole
 * point. Neither may write: a story that quietly POSTed somewhere would be a
 * story nobody could run offline, and the past is not editable.
 *
 * That it is one function is what makes the history pane cheap. Every read hook
 * a field component uses reaches its stores through `useValSystem()`, so
 * wrapping a subtree in a second system swaps SOURCE AND SCHEMA together for
 * that subtree — and the real field renderers draw the past without knowing
 * they are doing it. No field component knows this feature exists.
 */
export function createReadOnlySystem({
  schemas,
  sources,
  previews,
  fetchJsonEntry,
  noServerReason,
}: {
  schemas: Record<ModuleFilePath, SerializedSchema | undefined>;
  sources: Record<ModuleFilePath, Json | undefined>;
  previews?: Record<ModuleFilePath, ReifiedPreview | null>;
  /**
   * How to load a `.jsonValues()` entry, if this system can.
   *
   * A `.jsonValues()` record's source is only `{_type:"json"}` markers - the
   * content is per entry and fetched when something reads inside one. Without
   * this the store refuses the read (see `SourceStore.loadEntry`) and every
   * entry stays a marker, which the pane draws as an empty field: a claim that
   * the author left it blank.
   *
   * Optional because not every read-only system HAS somewhere to fetch from;
   * one built from a snapshot with the entries already inlined does not need
   * it, and refusing honestly is the right answer where there is nowhere to
   * ask.
   */
  fetchJsonEntry?: FetchJsonEntry;
  /** What to say when something asks this system for a patch it cannot fetch. */
  noServerReason: string;
}): System {
  const hostBridge: HostBridge = {
    async preview(moduleFilePath) {
      const preview = previews?.[moduleFilePath];
      return preview === undefined || preview === null
        ? { status: "unknown-module" }
        : { status: "previewed", preview };
    },
    async customValidate() {
      // No user closures to run — these schemas are already serialized, and
      // serializing is what strips them.
      return { status: "validated", errors: false };
    },
  };

  const system = createSystem({
    ...(fetchJsonEntry ? { fetchJsonEntry } : {}),
    // Nothing announces patch ids here, so nothing ever asks for one.
    fetchPatches: async (patchIds) => ({
      patches: [],
      errors: Object.fromEntries(
        patchIds.map((patchId) => [patchId, noServerReason]),
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
   * system that has never taken anything in reports `loading` for everything.
   * There are no `ValModule`s to hand over, so it says the intake happened with
   * none, which is true: the content arrives through the two calls below.
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
