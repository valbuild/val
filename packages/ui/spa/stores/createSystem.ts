import type {
  ModuleFilePath,
  SelectorSource,
  SerializedSchema,
  Source,
  SourcePath,
  ValModule,
  ValidationErrors,
} from "@valbuild/core";
import { SchemaValidator } from "../validation/validateModule";
import { SchemaStore } from "./SchemaStore";
import { SourceStore, type FetchJsonEntry } from "./SourceStore";
import {
  PatchStore,
  type CreatePatchId,
  type FetchPatches,
  type UploadFile,
} from "./PatchStore";
import { StatStore } from "./StatStore";
import { PatchSync, type ResyncChain, type SavePatches } from "./PatchSync";
import { HostStore } from "./HostStore";
import { RenderStore } from "./RenderStore";
import { PatchSetStore } from "./PatchSetStore";
import { ValidationStore } from "./ValidationStore";
import {
  SearchStore,
  type SearchResult,
  type SourceSnapshot,
} from "./SearchStore";
import {
  ReferenceStore,
  type Reference,
  type ReferenceQuery,
  type ReferenceScan,
  type ReferenceSnapshot,
} from "./ReferenceStore";
import type { SerializedPatchSet } from "../utils/PatchSets";
import type { SchemaValidationBridge } from "./bridges";
import { noopActivity, type ActivitySink } from "./activity";
import { StaleModules } from "./StaleModules";
import type {
  PatchSetBridge,
  ReferenceBridge,
  SearchBridge,
} from "./workerBridge";

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
  /**
   * The write-back loop. In the host realm because it drives the patch store,
   * and because a retry timer has to live where the chain does.
   */
  patchSync: PatchSync;
  renderStore: RenderStore;
  validationStore: ValidationStore;
};

/**
 * The WORKER realm: lazy, snapshot-shaped consumers holding no reference to
 * anything in the host realm.
 *
 * Typed as BRIDGES rather than as the concrete stores, and that is the payoff of
 * making the seam crossable: the in-process store satisfies the bridge
 * structurally, so the default costs nothing, and a real worker (see
 * `workerBridge.ts` / `workerEntry.ts`) drops in through `SystemOptions` without
 * a single caller changing. The same shape `SchemaValidationBridge` already has.
 */
export type WorkerRealm = {
  searchStore: SearchBridge;
  patchSetStore: PatchSetBridge;
  referenceStore: ReferenceBridge;
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
    /**
     * Who points at this thing, scanning first if the index owes a pass.
     *
     * On the system for the same reason `search` is: the reference store is in
     * the worker realm and cannot gather the source it needs. The QUERY is the
     * demand signal, so the query is what pays.
     */
    findReferences(query: ReferenceQuery): Promise<ReferenceScan>;
    /** What the field at one path points at. Scans first if a pass is owed. */
    referenceAt(path: SourcePath): Promise<Reference | null>;
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
  /**
   * Where a patch's file bytes are POSTed, and where a removed file is deleted.
   *
   * Omitting it means this system refuses any patch carrying files, rather than
   * accepting one and dropping the bytes — see `PatchStore.createPatch`.
   */
  uploadFile?: UploadFile;
  /**
   * Where one `.jsonValues()` entry's content is fetched from (`GET /json`).
   *
   * Omitting it means this system cannot read INTO an entry: such a read reports
   * an error rather than `absent`, because "the content is not here" and "nobody
   * can fetch it" are different facts and only one of them is about the content.
   */
  fetchJsonEntry?: FetchJsonEntry;
  /**
   * Where a local patch is written back to (`PUT /patches`).
   *
   * Omitting it means this system never writes: edits stay local, and
   * `patchSync.currentState()` reports them pending forever. That is the honest
   * behaviour for a driver with no server (a benchmark, a test of the read path)
   * and it is deliberately not a silent success — an edit that reports itself
   * saved when nothing was written is the worst outcome available here.
   */
  savePatches?: SavePatches;
  /**
   * Bring the chain back in step after a 409. Required WITH `savePatches` to
   * make conflicts recoverable; without it a conflict retries against the same
   * parent and can only fail again.
   */
  resyncChain?: ResyncChain;
  /** Attributes writes to this editing session. Metadata; nothing branches on it. */
  sessionId?: string | null;
  /** Retry backoff, injected so a test does not wait real seconds. */
  saveBackoffMs?: (attempt: number) => number;
  /** How the retry waits, injected for the same reason. */
  saveSleep?: (ms: number) => Promise<void>;
  /**
   * The worker realm. Defaults to the in-process stores.
   *
   * Supply these to move search, patch sets and references onto a real thread:
   * `createWorkerBridges(domEndpoint(new Worker(...)))` returns exactly this
   * shape. Nothing else in the system changes, which is the claim
   * `architecture.md` has been making about the realm split and
   * `workerBridge.test.ts` is what checks it — in an actual second thread.
   *
   * Two things do NOT cross and are lost when you do this: the worker stores'
   * events and their activity records, both of which are per-realm. See the
   * header of `workerBridge.ts`.
   */
  workerRealm?: {
    search: SearchBridge;
    patchSets: PatchSetBridge;
    references: ReferenceBridge;
  };
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
    options.uploadFile,
  );
  // No head callback: the source store owns its own revision now. The chain is
  // the patch store's business and cannot see a base-source replacement.
  const sourceStore = new SourceStore(
    schemaStore,
    activity,
    options.fetchJsonEntry,
  );
  const stat = new StatStore();
  const patchSync = new PatchSync(
    patchStore,
    // Passed through as-is, including `undefined`: no write seam is a real
    // configuration (a benchmark, a read-path test) and `PatchSync` reports it
    // as `pending`. A stand-in that returned a retryable error instead would
    // spin a retry loop forever against a server that does not exist.
    options.savePatches,
    options.resyncChain ?? (async () => {}),
    activity,
    options.sessionId,
    options.saveBackoffMs,
    options.saveSleep,
  );
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
  const searchStore: SearchBridge =
    options.workerRealm?.search ?? new SearchStore(activity);
  const patchSetStore: PatchSetBridge =
    options.workerRealm?.patchSets ?? new PatchSetStore(activity);
  const referenceStore: ReferenceBridge =
    options.workerRealm?.references ?? new ReferenceStore(activity);
  // Staleness is tracked HERE, on the host, not inside the worker-realm stores.
  // The host is the side that sees the change; keeping the set in the worker
  // meant pushing it in and reading it back, which across a thread boundary is
  // four messages for something already known. See `StaleModules`.
  const searchStale = new StaleModules("search:invalidate");
  const referenceStale = new StaleModules("references:invalidate");

  const unsubscribe = [
    patchStore.listenTo(stat, sourceStore),
    sourceStore.listenTo(patchStore),
    // The write is the one path that is not demand-driven: a local patch has to
    // reach the server whether or not anything reads it again. So the sync
    // subscribes to `patch:create` and drives itself.
    patchSync.listenTo(),
    // The parent ref is computed from stat, so the sync has to see every stat.
    // Read from the store rather than carried on the event, so the event stays
    // an announcement rather than becoming the API — see `currentBaseSha`.
    stat.events.on("stat:receive", (event) => {
      const baseSha = stat.currentBaseSha();
      if (baseSha === null) return;
      patchSync.receiveStat(baseSha, event.patches);
      // A stat can unblock a save that had no honest parent to name. Nothing
      // else would retry it: `patch:create` already fired and found no base.
      void patchSync.flush();
    }),
    renderStore.listenTo(),
    validationStore.listenTo(),

    // --- host-side staleness ----------------------------------------------
    // No longer a push ACROSS the seam: the host records what changed and keeps
    // it, so a query can decide what to gather without asking the worker
    // anything first.
    sourceStore.events.on("source:patch-apply", (event) => {
      searchStale.mark(event.modules);
      referenceStale.mark(event.modules);
    }),
    sourceStore.events.on("source:init", (event) => {
      searchStale.mark(event.sources);
      referenceStale.mark(event.sources);
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
      snapshot[moduleFilePath] = {
        source,
        schema,
        // Asked HERE, on the host side, because this is the last point at which
        // it can be: the search store is across the worker seam and cannot ask
        // the source store anything.
        complete: !sourceStore.hasUnloadedEntries(moduleFilePath),
      };
    }
    return snapshot;
  }

  /**
   * Bring the reference index up to date, then answer from it.
   *
   * Shared by both reference entry points so the scan-then-read pair cannot
   * drift: an `at()` served from a stale index reports what a field USED to
   * point at, which is the same class of bug as a stale referrer blocking a
   * safe delete.
   */
  async function rescanReferences(): Promise<void> {
    if (!referenceStale.needsPass()) {
      return;
    }
    // Only what the index owes a pass for. On a first query that is every loaded
    // module; after an edit it is the one module that changed. Decided here, from
    // host state, so a real seam is crossed once rather than four times.
    const target = referenceStale.target(sourceStore.loadedModules());
    const scanned = await referenceStore.rescan(
      gatherReferenceSnapshot(target),
    );
    // Marked covered from what the worker actually scanned, not from what was
    // asked for: a module it skipped (no schema, no source) must stay stale or it
    // never gets another chance.
    referenceStale.covers(scanned);
  }

  function gatherReferenceSnapshot(
    modules: ModuleFilePath[],
  ): ReferenceSnapshot {
    const schemas = schemaStore.all();
    const snapshot: ReferenceSnapshot = {};
    for (const moduleFilePath of modules) {
      const schema = schemas[moduleFilePath];
      const source = sourceStore.moduleSource(moduleFilePath);
      if (schema === undefined || source === undefined) continue;
      snapshot[moduleFilePath] = {
        source,
        schema,
        complete: !sourceStore.hasUnloadedEntries(moduleFilePath),
      };
    }
    return snapshot;
  }

  return {
    host,
    stat,
    schemaStore,
    sourceStore,
    patchStore,
    patchSync,
    renderStore,
    validationStore,
    searchStore,
    patchSetStore,
    referenceStore,
    async findReferences(query) {
      await rescanReferences();
      return referenceStore.find(query);
    },
    async referenceAt(path) {
      await rescanReferences();
      return referenceStore.at(path);
    },
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
      if (searchStale.needsPass()) {
        const target = searchStale.target(sourceStore.loadedModules());
        const indexed = await searchStore.reindex(gatherSnapshot(target));
        searchStale.covers(indexed.all);
      }
      const found = await searchStore.search(query, limit, offset);
      if (found.status === "no-index") {
        return found;
      }
      // Joined here, at the realm boundary: the worker's answer plus what the
      // host knows about staleness. Neither side has to interrogate the other.
      return { ...found, staleModules: searchStale.staleModules() };
    },
    async buildSearchIndex() {
      const loaded = sourceStore.loadedModules();
      const result = await searchStore.buildIndex(gatherSnapshot(loaded));
      searchStale.covers(result.all);
      return result;
    },
    dispose() {
      for (const off of unsubscribe) off();
      // Before the unsubscribes would be wrong-ish and after is right: a retry
      // mid-backoff has to be told to stop, or it wakes up and writes to a
      // torn-down system — in a test, after the test that made it has finished.
      patchSync.dispose();
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
export type { SourceSnapshot, ReferenceSnapshot };
