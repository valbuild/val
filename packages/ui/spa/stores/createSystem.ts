import type {
  ModuleFilePath,
  SelectorSource,
  SerializedSchema,
  Source,
  ValModule,
  ValidationErrors,
} from "@valbuild/core";
import { SchemaValidator } from "../validation/validateModule";
import { SchemaStore } from "./SchemaStore";
import { SourceStore } from "./SourceStore";
import {
  PatchStore,
  type CreatePatchId,
  type FetchPatches,
} from "./PatchStore";
import { StatStore } from "./StatStore";
import { HostStore } from "./HostStore";
import { RenderStore } from "./RenderStore";
import { PatchSetStore } from "./PatchSetStore";
import { ValidationStore } from "./ValidationStore";
import {
  SearchStore,
  type SearchResult,
  type SourceSnapshot,
} from "./SearchStore";
import type { SerializedPatchSet } from "../utils/PatchSets";
import type { SchemaValidationBridge } from "./bridges";
import { noopActivity, type ActivitySink } from "./activity";

/**
 * Stores in the HOST realm: they either hold user closures, or need to read
 * something that does.
 */
export type HostRealm = {
  host: HostStore;
  stat: StatStore;
  schemaStore: SchemaStore;
  sourceStore: SourceStore;
  patchStore: PatchStore;
  renderStore: RenderStore;
  validationStore: ValidationStore;
};

/**
 * Stores in the WORKER realm: lazy, snapshot-shaped consumers holding no
 * reference to anything in the host realm.
 */
export type WorkerRealm = {
  searchStore: SearchStore;
  patchSetStore: PatchSetStore;
};

export type System = HostRealm &
  WorkerRealm & {
    /**
     * Gather the snapshot the search index needs and hand it across the worker
     * seam. Explicit, because this is the one operation in the system that
     * copies every module — it must be a thing someone chose to do, not a side
     * effect of an edit.
     */
    buildSearchIndex(): Promise<{
      new: ModuleFilePath[];
      all: ModuleFilePath[];
    }>;
    /**
     * The patch-set grouping, gathered and built on demand.
     *
     * On the system rather than on the store for the same reason
     * `buildSearchIndex` is: the store is in the worker realm and cannot reach
     * the chain it needs, so the host side gathers and passes.
     */
    getPatchSets(): Promise<SerializedPatchSet>;
    /**
     * Search, indexing first if the index is missing or stale.
     *
     * The query is the demand signal, so it is the query that pays. Going
     * through the system is what makes that possible: the search store cannot
     * gather the snapshot itself.
     */
    search(
      query: string,
      limit?: number,
      offset?: number,
    ): Promise<SearchResult>;
    dispose(): void;
  };

export type SystemOptions = {
  fetchPatches: FetchPatches;
  createPatchId?: CreatePatchId;
  /**
   * The worker seam for schema validation. Defaults to an in-process
   * implementation so the prototype runs in one thread; a real
   * `postMessage`-backed one drops in without any store changing, because the
   * source and schema it needs are already arguments rather than reads.
   */
  schemaValidation?: SchemaValidationBridge;
  /**
   * Where stores report the work they do. Defaults to a sink that discards it,
   * so an uninstrumented run pays one returning method call per unit of work.
   *
   * Separate from the event buses on purpose — see `activity.ts`: nothing in the
   * system may react to a work record, and nothing does.
   */
  activity?: ActivitySink;
};

/**
 * In-process stand-in for the schema-validation worker.
 *
 * Async on purpose even though it resolves immediately: if any caller were
 * allowed to depend on it being synchronous, swapping in the real worker would
 * be a rewrite of that caller.
 */
class InProcessSchemaValidation implements SchemaValidationBridge {
  private validator = new SchemaValidator();
  async validate(
    moduleFilePath: ModuleFilePath,
    source: Source,
    serializedSchema: SerializedSchema,
    schemaVersion: string,
  ): Promise<ValidationErrors> {
    return this.validator.validate(
      moduleFilePath,
      source,
      serializedSchema,
      schemaVersion,
    );
  }
}

/**
 * Builds the store graph across both realms and wires it up.
 *
 * See `architecture.md` for the graph, the realm split, and the reasoning.
 *
 * Within a realm, stores talk by native `CustomEvent` on the emitting store's
 * own bus, plus plain synchronous READS (never mutations) — those are sync
 * precisely because the realm is shared. ACROSS the worker seam nothing is
 * observable, so the host side explicitly pushes: that is what the `listenTo`
 * calls at the bottom of this function are, and why they pass data rather than
 * store references.
 */
export function createSystem(options: SystemOptions): System {
  // --- host realm -----------------------------------------------------------
  const activity = options.activity ?? noopActivity;
  const schemaStore = new SchemaStore(activity);
  const patchStore = new PatchStore(
    options.fetchPatches,
    options.createPatchId,
    activity,
  );
  const sourceStore = new SourceStore(
    schemaStore,
    () => patchStore.currentHead(),
    activity,
  );
  const stat = new StatStore();
  const host = new HostStore(schemaStore, sourceStore, activity);
  const renderStore = new RenderStore(host, sourceStore, schemaStore, activity);
  const validationStore = new ValidationStore(
    schemaStore,
    sourceStore,
    options.schemaValidation ?? new InProcessSchemaValidation(),
    host,
    activity,
  );

  // --- worker realm ---------------------------------------------------------
  const searchStore = new SearchStore(activity);
  const patchSetStore = new PatchSetStore(activity);

  const unsubscribe = [
    patchStore.listenTo(stat, sourceStore),
    sourceStore.listenTo(patchStore),
    renderStore.listenTo(),
    validationStore.listenTo(),

    // --- host → worker pushes ---------------------------------------------
    // These exist because an event dispatched in the host realm is not
    // observable in the worker realm: `EventTarget` dispatch is per-realm. So
    // the host side subscribes and forwards, carrying the data with it.
    sourceStore.events.on("source:patch-apply", (event) => {
      searchStore.markStale(event.modules);
    }),
    sourceStore.events.on("source:init", (event) => {
      searchStore.markStale(event.sources);
    }),
  ];

  /**
   * Copy source + schema for the named modules, to hand across the worker seam.
   *
   * The one place the system copies module source, so it is counted with the
   * number of modules it touched: "how much of the project got gathered, and how
   * often" is the question this instrumentation exists to answer.
   */
  function gatherSnapshot(modules: ModuleFilePath[]): SourceSnapshot {
    const schemas = schemaStore.all();
    const snapshot: SourceSnapshot = {};
    activity.work("search:gather-snapshot", undefined, modules.length);
    for (const moduleFilePath of modules) {
      const schema = schemas[moduleFilePath];
      const source = sourceStore.moduleSource(moduleFilePath);
      // A module without a schema cannot be walked — the walk is schema-driven.
      // Skipping keeps it out of `all`, so it reads as not-indexed rather than
      // as indexed-and-empty.
      if (schema === undefined || source === undefined) continue;
      snapshot[moduleFilePath] = { source, schema };
    }
    return snapshot;
  }

  return {
    host,
    stat,
    schemaStore,
    sourceStore,
    patchStore,
    renderStore,
    validationStore,
    searchStore,
    patchSetStore,
    async getPatchSets() {
      return patchSetStore.getPatchSets(
        patchStore.allRecords(),
        schemaStore.all(),
        patchStore.chainVersion(),
      );
    },
    async search(query, limit, offset) {
      // Gather ONLY what the index owes a pass for. On a first query that is
      // every loaded module; after an edit it is the one module that changed.
      // The gather is the whole-project copy, so scoping it here is the point:
      // one edit then one query used to clone and re-walk the entire project.
      if (searchStore.needsIndex()) {
        const stale = searchStore.staleModules();
        const target =
          searchStore.indexedModules().length === 0
            ? sourceStore.loadedModules()
            : stale;
        await searchStore.reindex(gatherSnapshot(target));
      }
      return searchStore.search(query, limit, offset);
    },
    async buildSearchIndex() {
      return searchStore.buildIndex(
        gatherSnapshot(sourceStore.loadedModules()),
      );
    },
    dispose() {
      for (const off of unsubscribe) off();
    },
  };
}

/**
 * Intake, kept as a free function so the entry point reads the same as the real
 * app's: the host app owns the modules and hands them in.
 *
 * `HostStore.receive` is what actually does it — this only names the boundary.
 */
export function receiveModules(
  system: System,
  modules: ValModule<SelectorSource>[],
): void {
  system.host.receive(modules);
}

/** Re-exported so `SourceSnapshot`'s shape is visible from the system module. */
export type { SourceSnapshot };
