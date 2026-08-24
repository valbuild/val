import type {
  ModuleFilePath,
  PatchId,
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
import { StatusStore } from "./StatusStore";
import { PatchSync, type ResyncChain, type SavePatches } from "./PatchSync";
import { HostStore } from "./HostStore";
import { RenderStore } from "./RenderStore";
import { PatchSetStore, type PatchSetRequest } from "./PatchSetStore";
import { PatchSetChain, type PatchSetPlan } from "./PatchSetChain";
import type { PatchRecord } from "./types";
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
import type { HostBridge, SchemaValidationBridge } from "./bridges";
import { noopActivity, type ActivitySink } from "./activity";
import { StaleModules } from "./StaleModules";
import type {
  DiscardPatches,
  PublishPatches,
  PublishResult,
} from "./PublishSeam";
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
   * Everything the editor is TOLD — errors, the network, whether the schema it
   * holds is still the server's. Host realm: it is announcements, not content.
   */
  status: StatusStore;
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
    /**
     * Commit patches, if they are publishable.
     *
     * On the system because it is the one operation that needs three stores at
     * once: validation decides whether it may happen, patches say what is being
     * published, and source has to be left showing the right thing afterwards.
     */
    publish(patchIds: PatchId[], message?: string): Promise<PublishResult>;
    /**
     * Throw patches away.
     *
     * The opposite of publish in the one way that matters here: a discarded
     * patch's effect must DISAPPEAR, so source is rebuilt without it, whereas a
     * published patch's effect stays because it is in the base now.
     */
    discard(
      patchIds: PatchId[],
    ): Promise<{ status: "discarded" } | { status: "failed"; message: string }>;
    /**
     * Per patch in the chain: what `/save` refused it for, or `null`.
     *
     * On the system rather than read off the patch store by the caller only so
     * that "everything a publish gate needs" is reachable from one place.
     */
    patchErrors(): Record<PatchId, string[] | null>;
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
  /** `POST /save`. Omitting it means this system cannot publish. */
  publishPatches?: PublishPatches;
  /** `DELETE /patches`. Omitting it means this system cannot discard. */
  discardPatches?: DiscardPatches;
  /**
   * Does a publish leave the patches on the server?
   *
   * `fs` applies the patches to the `.val` files and deletes them, so the client
   * must take them out of its chain and keep showing the value. `http` keeps them
   * server-side and re-applies them, so the chain must stay or the value would be
   * counted twice. Defaults to `fs`, which is dev — the mode a wrong guess is
   * cheapest in.
   */
  mode?: "fs" | "http";
  /** Attributes writes to this editing session. Metadata; nothing branches on it. */
  sessionId?: string | null;
  /** Retry backoff, injected so a test does not wait real seconds. */
  saveBackoffMs?: (attempt: number) => number;
  /** How the retry waits, injected for the same reason. */
  saveSleep?: (ms: number) => Promise<void>;
  /**
   * Where renders and custom `validate` closures are RUN.
   *
   * Defaults to the `HostStore` this function creates, which is what the Studio
   * uses: the host app hands its `ValModules` over and the real `select` and
   * `validate` closures run against live source.
   *
   * Supply one to answer from somewhere else. A Storybook story is the case that
   * exists: it has static renders and no `ValModules`, and without this its
   * fields would render with every render node missing — which is not what the
   * story is showing. Same shape of injection as `schemaValidation` and
   * `workerRealm`, and for the same reason: `HostBridge` is a seam, and
   * `HostStore` is one implementation of it.
   *
   * `system.host` is still the `HostStore` either way, because `host.receive` is
   * how modules get in and a bridge cannot take them. A caller that supplies a
   * bridge simply never calls it.
   */
  hostBridge?: HostBridge;
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
  const status = new StatusStore(activity);
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
  const hostBridge = options.hostBridge ?? host;
  const renderStore = new RenderStore(
    hostBridge,
    sourceStore,
    schemaStore,
    activity,
  );
  const validationStore = new ValidationStore(
    schemaStore,
    sourceStore,
    options.schemaValidation ?? new InProcessSchemaValidation(),
    hostBridge,
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
  // What the grouping holds, and whether the next read can append to it. Host
  // side for the same reason `StaleModules` is: the host saw the change. See
  // `PatchSetChain` for why it is a prefix test rather than a list of moments.
  const patchSetChain = new PatchSetChain();
  /** One publish at a time. See `publish`. */
  let publishing = false;

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

    // --- patch-set invalidation -------------------------------------------
    // A schema replaced under patches that are otherwise untouched. The prefix
    // test cannot see this — the ids are identical — and it matters because patch
    // sets are grouped using the schema at the op's path, so what is already
    // inserted was grouped against a schema that no longer exists.
    schemaStore.events.on("schema:init", () => {
      patchSetChain.invalidate();
    }),
    // A drop is the other case the ids DO show — the chain shrank, so the prefix
    // test would rebuild anyway. Invalidating explicitly costs nothing and means
    // the guarantee does not rest on the chain happening to get shorter: a drop
    // of the last patch followed by a new one is the same LENGTH as before.
    patchStore.events.on("patch:drop", () => {
      patchSetChain.invalidate();
    }),
  ];

  /**
   * Turn a plan into the payload it needs, and nothing more.
   *
   * The records are filtered to the ids the plan named, and the schemas to the
   * modules THOSE records touch. Both matter: the caller used to send the whole
   * chain and `schemaStore.all()` on every read — every module in the project, to
   * group patches that usually touch one — which is why this was the worst row in
   * the worker-seam benchmark.
   */
  function patchSetRequest(
    plan: PatchSetPlan,
    chain: PatchRecord[],
  ): PatchSetRequest {
    if (plan.mode === "current") {
      return { mode: "current" };
    }
    const wanted = new Set(plan.patchIds);
    const records = chain.filter((record) => wanted.has(record.patchId));
    const allSchemas = schemaStore.all();
    const schemas: Record<ModuleFilePath, SerializedSchema> = {};
    for (const record of records) {
      const schema = allSchemas[record.moduleFilePath];
      // A module with no schema is passed as absent rather than skipped:
      // `PatchSets.insert` handles `undefined` deliberately, grouping the patch
      // at the module root instead of dropping it.
      if (schema !== undefined) {
        schemas[record.moduleFilePath] = schema;
      }
    }
    activity.work("patch-set:gather", undefined, records.length);
    return { mode: plan.mode, records, schemas };
  }

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
    status,
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
      // `allRecords()`, so the chain compared against is the patches whose OPS
      // have arrived — not `ordered`, which can name an announced patch this
      // client has never seen the contents of. Using `ordered` would ask for a
      // rebuild carrying a record that does not exist yet; using this means a
      // foreign patch announced mid-chain reads as `current` until its data
      // lands, and as a rebuild the moment it does.
      const chain = patchStore.allRecords();
      const plan = patchSetChain.plan(chain.map((record) => record.patchId));
      const request = patchSetRequest(plan, chain);
      const sets = await patchSetStore.getPatchSets(request);
      // AFTER the call, not before: a worker that threw or a message that was
      // never answered must not leave the host believing the grouping moved.
      patchSetChain.covers(plan);
      return sets;
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
    async publish(patchIds, message) {
      if (options.publishPatches === undefined) {
        return {
          status: "failed",
          message: "This system has no publish seam configured.",
          retryable: false,
        };
      }
      if (patchIds.length === 0) {
        return { status: "nothing-to-publish" };
      }
      if (publishing) {
        // Two publishes of overlapping patches is a race whose loser publishes
        // ids the winner has already consumed. Refused rather than queued: a
        // second publish is a second click, and the honest answer is "one is
        // already running".
        return { status: "refused", reason: "already-publishing" };
      }
      publishing = true;
      try {
        // Validate the affected modules FIRST, and validate them rather than
        // reading what is cached. The engine's own comment explains why: custom
        // validators run on their own module's change, so a module edited before
        // a validator existed — or edited in another session — has never had them
        // run. Reading a cached result would make the gate recent rather than
        // complete.
        const affected = new Set<ModuleFilePath>();
        for (const record of patchStore.recordsFor(patchIds)) {
          affected.add(record.moduleFilePath);
        }
        const invalid: ModuleFilePath[] = [];
        for (const moduleFilePath of affected) {
          const result = await validationStore.validate(moduleFilePath);
          if (
            result.status === "validated" &&
            result.errors !== false &&
            Object.keys(result.errors).length > 0
          ) {
            invalid.push(moduleFilePath);
          }
        }
        if (invalid.length > 0) {
          return {
            status: "refused",
            reason: "validation-errors",
            modules: invalid,
          };
        }

        const outcome = await options.publishPatches({ patchIds, message });
        if (outcome.status === "patch-errors") {
          // Recorded, not just returned. A server refusal never resolves itself,
          // so the publish gate has to keep seeing it after the caller that made
          // this call has gone — see `PatchStore.publishErrors`.
          patchStore.recordPublishErrors(outcome.errors);
          return {
            status: "failed",
            message: outcome.message,
            patchErrors: outcome.errors,
            retryable: false,
          };
        }
        if (outcome.status !== "published") {
          return {
            status: "failed",
            message: outcome.message,
            // A 409 means someone else committed first, which is retryable once
            // this client has caught up. A network error says nothing about
            // whether the publish happened, which is also retryable — and is why
            // `/save` has to be idempotent in the patch ids it is given.
            retryable:
              outcome.status === "not-fast-forward" ||
              outcome.status === "network-error",
          };
        }

        if ((options.mode ?? "fs") === "fs") {
          // ORDER MATTERS, and this is the whole reason both methods exist.
          // Promote first: the patched value becomes the base, so when the chain
          // goes the displayed value does not move. Reversed, every published
          // field would flash back to its pre-publish text until the next source
          // fetch landed.
          sourceStore.promoteToBase([...affected]);
          sourceStore.forgetPublished(patchIds);
          patchStore.forgetPublished(patchIds);
        }
        // In `http` mode the patches stay server-side and are re-applied, so the
        // chain stays too — removing it would show the value without them until
        // the next fetch, and promoting the base would then double-apply.
        return { status: "published", patchIds };
      } finally {
        publishing = false;
      }
    },
    async discard(patchIds) {
      if (options.discardPatches === undefined) {
        return {
          status: "failed",
          message: "This system has no discard seam configured.",
        };
      }
      const res = await options.discardPatches(patchIds);
      if (res.status === "error") {
        return { status: "failed", message: res.message };
      }
      // The ids the SERVER says it deleted, not the ids we asked about: a partial
      // delete must not make the client forget a patch that still exists.
      patchStore.drop(res.patchIds);
      return { status: "discarded" };
    },
    patchErrors() {
      return patchStore.publishErrors();
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
