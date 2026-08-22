import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SelectorSource,
  type SerializedSchema,
  type ValModule,
} from "@valbuild/core";
import { SchemaStore } from "./SchemaStore";
import { SourceStore } from "./SourceStore";
import {
  PatchStore,
  type CreatePatchId,
  type FetchPatches,
} from "./PatchStore";
import { StatStore } from "./StatStore";
import { PatchSetStore } from "./PatchSetStore";
import { ValidationStore } from "./ValidationStore";
import { SearchStore } from "./SearchStore";

export type System = {
  stat: StatStore;
  schemaStore: SchemaStore;
  patchStore: PatchStore;
  sourceStore: SourceStore;
  patchSetStore: PatchSetStore;
  validationStore: ValidationStore;
  searchStore: SearchStore;
  /**
   * The serialization boundary.
   *
   * Takes real `ValModule`s — which hold `Schema` INSTANCES, so they carry the
   * user's `select` and custom `validate` closures — and hands the stores only
   * serialized schemas and plain JSON source. Everything past this call is
   * structured-cloneable, which is the precondition for putting the whole set
   * of stores inside a worker.
   */
  receiveModules(modules: ValModule<SelectorSource>[]): void;
  dispose(): void;
};

export type SystemOptions = {
  fetchPatches: FetchPatches;
  createPatchId?: CreatePatchId;
};

/**
 * Builds the store graph and wires it up.
 *
 * See `architecture.md` in this directory for the graph and the reasoning.
 *
 * Every arrow between stores is a native event on the emitting store's own bus.
 * The only exceptions are plain synchronous READS (`schemaStore.get`,
 * `patchStore.currentHead`, `sourceStore.moduleSource`) — never mutations — and
 * they are sync precisely because all stores share a realm; see
 * {@link StoreBus}. Nothing here touches `window`, `document` or React, so the
 * same graph runs on the main thread, inside one worker, or in a node test.
 */
export function createSystem(options: SystemOptions): System {
  const schemaStore = new SchemaStore();
  const patchStore = new PatchStore(
    options.fetchPatches,
    options.createPatchId,
  );
  const sourceStore = new SourceStore(schemaStore, () =>
    patchStore.currentHead(),
  );
  const stat = new StatStore();
  const patchSetStore = new PatchSetStore(schemaStore);
  const validationStore = new ValidationStore(schemaStore, sourceStore);
  const searchStore = new SearchStore(schemaStore, sourceStore);

  const unsubscribe = [
    patchStore.listenTo(stat, sourceStore),
    sourceStore.listenTo(patchStore),
    patchSetStore.listenTo(patchStore),
    validationStore.listenTo(),
    searchStore.listenTo(),
  ];

  return {
    stat,
    schemaStore,
    patchStore,
    sourceStore,
    patchSetStore,
    validationStore,
    searchStore,
    receiveModules(modules) {
      const schemas: Record<ModuleFilePath, SerializedSchema> = {};
      const sources: Record<ModuleFilePath, Json> = {};
      for (const module of modules) {
        const path = Internal.getValPath(module);
        if (path === undefined) {
          throw new Error("Module has no path");
        }
        const moduleFilePath = path as string as ModuleFilePath;
        const schema = Internal.getSchema(module);
        if (schema === undefined) {
          throw new Error(`Module '${moduleFilePath}' has no schema`);
        }
        // Bracket access, as `extractValModules` does: `instanceof Schema`
        // cannot be used because the SPA and the host bundle each ship their
        // own copy of @valbuild/core, so the class identity differs.
        schemas[moduleFilePath] = schema["executeSerialize"]();
        // JSON round-trip so what the stores hold is exactly what would survive
        // a structured clone — no `Schema` instance can leak through by accident.
        sources[moduleFilePath] = JSON.parse(
          JSON.stringify(Internal.getSource(module)),
        ) as Json;
      }
      // Schemas first: `SourceStore.get` refuses to answer `absent` for a
      // module whose schema is unknown, so arriving in the other order would
      // make the first read after init say `module-loading`.
      schemaStore.receive(schemas);
      sourceStore.receive(sources);
    },
    dispose() {
      for (const off of unsubscribe) off();
    },
  };
}
