import {
  deserializeSchema,
  ExtractedModuleError,
  ExtractedValModules,
  extractValModules,
  Internal,
  Json,
  ModuleFilePath,
  PatchId,
  Schema,
  SelectorSource,
  SerializedSchema,
  Source,
  SourcePath,
  ValidationError,
  ValidationErrors,
  ValModules,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import {
  applyPatch,
  deepClone,
  deepEqual,
  JSONOps,
  JSONValue,
} from "@valbuild/core/patch";
import {
  JSON_ENTRIES_BATCH_MAX,
  ParentRef,
  ValClient,
  Patch,
  resolveSchemaSourceFixes,
} from "@valbuild/shared/internal";
import { canMerge } from "./utils/mergePatches";
import { PatchSets, SerializedPatchSet } from "./utils/PatchSets";
import { ReifiedRender } from "@valbuild/core";
import {
  collectCustomValidateTargets,
  hasCustomValidate,
} from "./validation/customValidate";
import { yieldToBackground } from "./utils/yieldToBackground";
import {
  ValidationWorkerClient,
  type ValidationWorkerFactory,
} from "./validation/ValidationWorkerClient";
import { partitionValidationErrors } from "./validation/partitionValidationErrors";

/**
 * ValSyncEngine is the engine that keeps track of the state of the Val client.
 * It is intended to be used with useSyncExternalStore.
 *
 * It is a MASSIVE class that handles all the syncing, patching, and state management for the Val client.
 * Lack of time / the complexity of the domain together with ambitious performance goals (and maybe incompetency?),
 * but not lack of caring (!), is the reason it is so big.
 *
 * NOTE: simply splitting it in smaller modules was considered to be a bad fix to this problem since,
 * although this file would be smaller, the actual complexity would not be reduced and it would
 * most likely (at least we believe so) make it even harder to work with / reason about.
 *
 * We believe that we either must:
 *  1) accept that this is complex and make sure it is well tested (this is where we try to go now)
 *  2) find a better model of the problem / cut down on the performance ambitions
 *
 * NOTE: we haven't actually measured the performance well, so one might argue that until we do that
 * we have no business in optimizing for performance. However, wrt performance the stance now is to,
 * for obviously common operations (writing text a string / richtext field),
 * we should to think a bit about what the minimum amount of work is required to safely get the job done (duh).
 * What we're trying to say is... ...That although optimizing performance is stupid without measuring,
 * it is even stupider to do lots of work that we simply know is unnecessary.
 */
export class ValSyncEngine {
  private initializedAt: number | null;
  /**
   * When the first syncPatches run finished with every patch's data present.
   *
   * Distinct from `initializedAt`, which `setValModules` sets as soon as local
   * modules are adopted so content can render before /stat arrives - i.e. it can
   * be non-null while the patch sets are still empty because nothing has been
   * read yet, not because there is nothing pending.
   */
  private initialPatchSyncCompletedAt: number | null;
  private autoPublish: boolean = false;
  /**
   * Patch Ids reported by the /stat endpoint or webhook
   *
   * These are all the patch ids that are currently in the server; from this client AND FROM OTHER CLIENTS.
   **/
  private globalServerSidePatchIds: PatchId[] | null;
  /**
   * Patch Ids created by this client, that are not yet stored
   */
  private pendingClientPatchIds: PatchId[];
  /**
   * Patch Ids that have been successfully been applied (or skipped) server side
   */
  private syncedServerSidePatchIds: PatchId[];
  /**
   * Patch Ids that have been saved server side, but that not part of the global server state
   * i.e. they are currently only known by this client
   */
  private savedButNotYetGlobalServerSidePatchIds: PatchId[];
  /**
   * Maps each per-instance creator id (e.g. `useFieldCreatorId()`) to the
   * ordered list of PatchIds it produced. Only populated when creatorId is
   * provided (i.e. user field edits, not AI). Instance-scoped — never path —
   * so a re-mounted field at the same path doesn't inherit the previous
   * instance's "is editing" status.
   */
  private patchIdsByCreatorId: Map<string, PatchId[]>;
  /**
   * Maps each ModuleFilePath to the set of PatchIds that belong to it.
   * Incrementally maintained alongside patchDataByPatchId.
   */
  private patchIdsByModuleFilePath: Map<ModuleFilePath, Set<PatchId>>;
  private publishDisabled: boolean;
  private isPublishing: boolean;
  /**
   * Number of successful publishes in this session.
   *
   * A publish invalidates everything a view derived from the patch sets: the
   * patches it was showing are committed and the base they were diffed
   * against has moved. Views that show that derived state (the compare view)
   * subscribe to this so they can rebuild from scratch instead of keeping the
   * pre-publish result around.
   */
  private publishCount: number;
  private patchDataByPatchId: Record<
    PatchId,
    | {
        moduleFilePath: ModuleFilePath;
        patch: Patch;
        isPending: boolean;
        createdAt: string;
        authorId: string | null;
        isCommitted?: {
          commitSha: string;
        };
      }
    | undefined
  >;
  private authorId: string | null;
  private patchSets: PatchSets;
  /**
   * Un-patched source values, as delivered by `/sources/~` with
   * `apply_patches=false`, or seeded from the local val modules registry.
   * The patched view shown by the UI is computed on demand by applying
   * server-side + pending client patches in `getPatchedSource`. The
   * compare-view "before" reads this directly.
   */
  private serverSources: Record<ModuleFilePath, JSONValue | undefined> | null;
  /**
   * Per-module cache of the most recently computed patched source, keyed by
   * the ordered list of patch ids that produced it. `getPatchedSource` uses
   * the cached entry's `patchIds` as a prefix check: if the next ordered
   * patch list extends the cached one, only the new tail is applied;
   * otherwise the result is rebuilt from `serverSources`.
   */
  private patchedSourcesCache: Record<
    ModuleFilePath,
    | {
        patchIds: PatchId[];
        source: JSONValue | undefined;
      }
    | undefined
  > | null;
  /**
   * Loaded content for `.jsonValues()` record entries, keyed by module then
   * entry key. The on-disk source only carries lazy `{ _type:"json" }`
   * markers; the Studio fetches an entry's content on demand via
   * `requestJsonEntry` (GET /json) and `getPatchedSource` substitutes it in so
   * field resolution/rendering works.
   */
  private jsonEntryContents: Record<ModuleFilePath, Record<string, JSONValue>> =
    {};
  /** In-flight json entry loads, keyed `${moduleFilePath}\0${key}`. */
  private loadingJsonEntries: Map<string, Promise<void>> = new Map();
  /**
   * Entries whose last load failed, keyed by module then entry key. Memoizing
   * the failure is what stops a permanently-failing entry from being refetched
   * on every field remount (and from rendering a spinner forever): the field
   * hooks surface this as an error state instead. Cleared by `retryJsonEntry`
   * and whenever the module's server source is replaced.
   */
  private jsonEntryErrors: Record<ModuleFilePath, Record<string, string>> = {};
  /**
   * Loaded entries whose committed content may now be out of date (the module's
   * server source was replaced, e.g. after publish), keyed
   * `${moduleFilePath}\0${key}`. They keep rendering their old content until the
   * refetch lands, so there is no loading flash — but they MUST be refetched, or
   * a published edit appears to revert to the pre-edit content.
   */
  private staleJsonEntries: Set<string> = new Set();
  /**
   * Progress of the CURRENT json-entry load run, spanning every module and every
   * batch in flight — deliberately not per module, so a UI percentage does not
   * visibly reset at each module boundary. Counts up as keys resolve (loaded,
   * missing or failed all count as resolved) and resets to zero once nothing is
   * in flight.
   */
  private jsonEntriesProgress: { requested: number; resolved: number } = {
    requested: 0,
    resolved: 0,
  };
  /**
   * Keys queued by {@link requestJsonEntry} / {@link requestJsonEntries} for the
   * next coalesced flush. A record list renders one `<Preview>` per key and each
   * asks for its own entry, so without this a record with N entries fires N
   * requests; with it, one render pass costs one request per module.
   */
  private pendingJsonEntryRequests: Map<ModuleFilePath, Set<string>> =
    new Map();
  private jsonEntryFlushScheduled = false;
  private renders: Record<ModuleFilePath, ReifiedRender | null> | null;
  private schemas: Record<ModuleFilePath, SerializedSchema | undefined> | null;
  private serverSideSchemaSha: string | null;
  private clientSideSchemaSha: string | null;
  /**
   * Schemas extracted client-side from a ValModules registry. When non-null
   * these are adopted as authoritative — `syncSchema()` skips the /schema
   * fetch and `syncWithUpdatedStat()` no longer resets+inits on a remote
   * schema-SHA change (it flags `schemaOutOfDate` in http mode instead).
   */
  private localSchemas: Record<ModuleFilePath, SerializedSchema> | null;
  private localSchemaSha: string | null;
  /**
   * The user's REAL `Schema` instances, straight from the ValModules registry —
   * not a `deserializeSchema` copy of the serialized form.
   *
   * They exist only when the host app renders `<ValModulesClient>`; without it
   * this stays null and everything falls back to the serialized behaviour. What
   * they carry that serialization cannot: the render `select` functions, the
   * custom validate functions and the router. Anything needing schema BEHAVIOUR
   * (rather than shape) has to read these.
   *
   * Cross-bundle identity is a non-issue: the identity symbols use `Symbol.for`,
   * and protected methods are reached by bracket access (`schema["executeX"]()`)
   * precisely because `instanceof` is unreliable across two copies of core.
   */
  private localSchemaInstances: Record<
    ModuleFilePath,
    Schema<SelectorSource>
  > | null;
  /**
   * Un-patched sources extracted client-side from a ValModules registry.
   * Used to seed `serverSources` immediately (before /sources/~ resolves)
   * when no server response has landed yet. Patches are layered on top via
   * `getPatchedSource`, so this only needs to carry the on-disk content.
   */
  private localSources: Record<ModuleFilePath, Source> | null;
  private localSourcesSha: string | null;
  /**
   * Status of the client-side extraction. Drives both the schema/source
   * adoption decisions and the dev-only LocalModulesErrorBanner.
   */
  private localModulesStatus: LocalModulesStatus;
  /**
   * Monotonic token for `setValModules`. Each invocation captures the current
   * value; after its `await`, a stale (superseded) call bails out so a slower
   * earlier extraction can't overwrite a newer registry's schemas/sources.
   */
  private setValModulesSeq = 0;
  private schemaOutOfDate: boolean;
  private mode: "fs" | "http" | null;

  private commitSha: string | null;
  private baseSha: string | null; // TODO: Currently only used for headBaseSha in head patches - we think we should replace headBaseSha with headSourcesSha
  private sourcesSha: string | null;
  /**
   * Last seen fingerprint of the `.jsonValues()` entry files (FS mode only). See
   * syncWithUpdatedStat.
   */
  private jsonEntriesSha: string | undefined;
  private syncStatus: Record<SourcePath | ModuleFilePath, SyncStatus>;
  private pendingOps: PendingOp[];
  private errors: Partial<{
    /**
     * Transient global errors are errors that are
     * 1) transient (reloading might fix)
     * 2) affects entire Val Studio app: not just a patch or a module
     *
     * They will be showed in a toast notification. (should we rename to toastQueue?)
     * Examples: network errors, transient sync errors, ...
     */
    globalTransientErrorQueue: {
      message: string;
      timestamp: number;
      details?: string;
      id: string;
    }[];
    // TODO: unused for now, so remove:
    // /**
    //  * Persistent global errors are errors that are
    //  * 1) persistent / permanent (reloading won't fix)
    //  * 2) requires a developer to fix
    //  * 3) affects entire Val Studio app: not just a patch or a module
    //  *
    //  * These errors will be showed prominently in the UI and cannot be dismissed.
    //  * NOTE: Persistent errors also prohibits publishing.
    //  * Examples: invalid config, invalid schema, ...
    //  */
    // persistentGlobalError: string | null;
    // /** Errors that prohibits publishing */
    // publishError: string | null;
    // patchErrors: Record<PatchId, string | null>;
    /**
     * If hasNetworkErrorTimestamp is not null, we show a network error
     */
    hasNetworkErrorTimestamp: number | null;
    /**
     * If hasSchemaErrorTimestamp is not null, we show a schema error
     */
    hasSchemaErrorTimestamp: number | null;
    validationErrors: Record<SourcePath, ValidationError[] | undefined>;
    patchErrors: Record<
      ModuleFilePath,
      Record<PatchId, PatchErrorEntry> | null
    >;
  }>;
  /**
   * If this is true, the next sync (and only the next) will sync all modules
   *
   * We use this if there's unknown patch ids or to initialize
   */
  private forceSyncAllModules: boolean;
  /**
   * Modules whose patch errors changed during a snapshot read and still need to
   * be emitted. See schedulePatchErrorsInvalidation.
   */
  private pendingPatchErrorInvalidations: Set<ModuleFilePath> | null;

  /**
   * Owns the validation worker. Lazily created on first use so tests / SSR
   * (where `Worker` is undefined) don't pay the cost. When local schemas are
   * present this is the sole source of `validationErrors` — server-side
   * validation is suppressed via `validate_sources=false` on `/sources/~`.
   */
  private validationWorker: ValidationWorkerClient | null;

  constructor(
    private readonly client: ValClient,
    private readonly overlayEmitter:
      | typeof defaultOverlayEmitter
      | undefined = undefined,
    // Injected by the composition root (ValProvider). Kept out of this file so
    // the worker's import.meta reference never reaches the Jest-compiled core.
    // When undefined (tests / SSR / stories) validation runs on the main thread.
    private readonly createValidationWorker:
      | ValidationWorkerFactory
      | undefined = undefined,
  ) {
    this.initializedAt = null;
    this.initialPatchSyncCompletedAt = null;
    this.forceSyncAllModules = true;
    this.pendingPatchErrorInvalidations = null;
    this.errors = {};
    this.listeners = {};
    this.syncStatus = {};
    this.schemas = null;
    this.serverSideSchemaSha = null;
    this.clientSideSchemaSha = null;
    this.localSchemas = null;
    this.localSchemaSha = null;
    this.localSchemaInstances = null;
    this.localSources = null;
    this.localSourcesSha = null;
    this.localModulesStatus = { type: "absent" };
    this.schemaOutOfDate = false;
    this.baseSha = null;
    this.sourcesSha = null;
    this.mode = null;
    this.serverSources = null;
    this.patchedSourcesCache = null;
    this.renders = null;
    this.globalServerSidePatchIds = [];
    this.syncedServerSidePatchIds = [];
    this.savedButNotYetGlobalServerSidePatchIds = [];
    this.patchIdsByCreatorId = new Map();
    this.patchIdsByModuleFilePath = new Map();
    this.pendingOps = [];
    this.pendingClientPatchIds = [];
    this.patchDataByPatchId = {};
    this.isSyncing = false;
    this.patchSets = new PatchSets();
    this.authorId = null;
    this.publishDisabled = true;
    this.isPublishing = false;
    this.publishCount = 0;
    this.commitSha = null;
    //
    this.cachedSourceSnapshots = null;
    this.cachedServerSourceSnapshots = null;
    this.cachedBaseSourceSnapshots = null;
    this.cachedSchemaSnapshots = null;
    this.cachedRenderSnapshots = null;
    this.cachedPatchData = null;
    this.cachedSerializedPatchSetsSnapshot = null;
    this.cachedValidationErrors = null;
    this.cachedAllSchemasSnapshot = null;
    this.cachedDeserializedSchemas = null;
    this.cachedGlobalServerSidePatchIdsSnapshot = null;
    this.cachedPendingClientSidePatchIdsSnapshot = null;
    this.cachedSyncedServerSidePatchIdsSnapshot = null;
    this.cachedSavedServerSidePatchIdsSnapshot = null;
    this.cachedAllSourcesSnapshot = null;
    this.cachedAllRendersSnapshot = null;
    this.cachedSourcesSnapshot = null;
    this.cachedSyncStatus = null;
    this.cachedPendingOpsCountSnapshot = null;
    this.cachedInitializedAtSnapshot = null;
    this.cachedAutoPublishSnapshot = null;
    this.cachedPublishDisabledSnapshot = null;
    this.cachedSchemaOutOfDateSnapshot = null;
    this.cachedLocalModulesStatusSnapshot = null;
    this.cachedGlobalTransientErrorSnapshot = null;
    this.cachedParentRef = undefined;
    this.cachedPatchErrorsSnapshot = null;
    this.validationWorker = null;
  }

  setAutoPublish(now: number, autoPublish: boolean) {
    this.autoPublish = autoPublish;
    try {
      localStorage.setItem("val-auto-publish", autoPublish.toString());
    } catch {
      // ignore
    }
    this.invalidateAutoPublish();
    return this.sync(now);
  }

  private loadAutoPublish() {
    try {
      this.autoPublish = localStorage.getItem("val-auto-publish") === "true";
      this.invalidateAutoPublish();
    } catch {
      // ignore
    }
  }

  async init(
    mode: "fs" | "http",
    baseSha: string,
    schemaSha: string,
    sourcesSha: string,
    patchIds: PatchId[],
    authorId: string | null,
    commitSha: string | null,
    now: number,
  ) {
    this.mode = mode;
    this.baseSha = baseSha;
    this.commitSha = commitSha;
    // Do NOT pre-set this.sourcesSha — syncWithUpdatedStat compares the
    // previous value (which adoptLocalSources may have set to
    // localSourcesSha) against the new server SHA to detect divergence.
    this.authorId = authorId;
    const start = Date.now();
    if (mode === "fs") {
      this.loadAutoPublish();
    } else {
      this.autoPublish = false;
    }
    const res = await this.syncWithUpdatedStat(
      mode,
      baseSha,
      schemaSha,
      sourcesSha,
      patchIds,
      authorId,
      commitSha,
      now,
    );
    if (res.status === "done") {
      await this.syncPatches(true, now);
      this.publishDisabled = false;
      this.invalidatePublishDisabled();
      this.initializedAt = now + (Date.now() - start);
      this.invalidateInitializedAt();
    }
    return res;
  }

  reset() {
    console.debug("Resetting ValSyncEngine");
    this.initializedAt = null;
    this.initialPatchSyncCompletedAt = null;
    this.forceSyncAllModules = true;
    this.pendingPatchErrorInvalidations = null;
    this.errors = {};
    // NOTE: this.listeners is deliberately NOT cleared. `subscribe` closes over
    // the listener registry, so replacing it here would leave every mounted
    // component subscribed to an object that `emit` no longer reads from - the
    // UI would silently stop updating for the rest of the session.
    this.syncStatus = {};
    this.schemas = null;
    this.serverSideSchemaSha = null;
    this.clientSideSchemaSha = null;
    this.localSchemas = null;
    this.localSchemaSha = null;
    this.localSchemaInstances = null;
    this.localSources = null;
    this.localSourcesSha = null;
    this.localModulesStatus = { type: "absent" };
    this.schemaOutOfDate = false;
    this.sourcesSha = null;
    this.serverSources = null;
    this.patchedSourcesCache = null;
    this.jsonEntryContents = {};
    this.loadingJsonEntries = new Map();
    this.jsonEntryErrors = {};
    this.staleJsonEntries = new Set();
    this.jsonEntriesProgress = { requested: 0, resolved: 0 };
    this.cachedJsonEntriesProgressSnapshot = null;
    this.pendingJsonEntryRequests = new Map();
    // Deliberately NOT clearing jsonEntryFlushScheduled: a flush may already be
    // queued, and it must find an empty pending map rather than a second flush
    // being scheduled behind it.
    this.renders = null;
    this.globalServerSidePatchIds = [];
    this.syncedServerSidePatchIds = [];
    this.savedButNotYetGlobalServerSidePatchIds = [];
    this.patchIdsByCreatorId = new Map();
    this.patchIdsByModuleFilePath = new Map();
    this.pendingOps = [];
    this.pendingClientPatchIds = [];
    this.patchDataByPatchId = {};
    this.isSyncing = false;
    this.patchSets = new PatchSets();
    this.authorId = null;
    this.publishDisabled = true;
    this.isPublishing = false;
    this.commitSha = null;
    //
    this.cachedSourceSnapshots = null;
    this.cachedServerSourceSnapshots = null;
    this.cachedBaseSourceSnapshots = null;
    this.cachedSchemaSnapshots = null;
    this.cachedRenderSnapshots = null;
    this.cachedPatchData = null;
    this.cachedSerializedPatchSetsSnapshot = null;
    this.cachedValidationErrors = null;
    this.cachedAllSchemasSnapshot = null;
    this.cachedDeserializedSchemas = null;
    this.cachedGlobalServerSidePatchIdsSnapshot = null;
    this.cachedPendingClientSidePatchIdsSnapshot = null;
    this.cachedSyncedServerSidePatchIdsSnapshot = null;
    this.cachedSavedServerSidePatchIdsSnapshot = null;
    this.cachedAllSourcesSnapshot = null;
    this.cachedAllRendersSnapshot = null;
    this.cachedSyncStatus = null;
    this.cachedPendingOpsCountSnapshot = null;
    this.cachedInitializedAtSnapshot = null;
    this.cachedAutoPublishSnapshot = null;
    this.cachedPublishDisabledSnapshot = null;
    this.cachedSchemaOutOfDateSnapshot = null;
    this.cachedLocalModulesStatusSnapshot = null;
    this.cachedGlobalTransientErrorSnapshot = null;
    this.cachedParentRef = undefined;
    this.cachedPatchErrorsSnapshot = null;

    // Terminate the validation worker thread so a re-init doesn't leak it.
    // getValidationWorker() lazily recreates it on next use.
    this.validationWorker?.dispose();
    this.validationWorker = null;
    if (this.overlayEmitTimeout !== null) {
      clearTimeout(this.overlayEmitTimeout);
      this.overlayEmitTimeout = null;
    }
    this.pendingOverlayEmits.clear();

    this.invalidateInitializedAt();
  }

  // #region Subscribe
  private listeners: Partial<
    Record<SyncEngineListenerType, Record<string, Set<() => void>>>
  >;

  /**
   * Memoised per (type, paths).
   *
   * `useSyncExternalStore` re-subscribes whenever the subscribe function's
   * identity changes, and almost every call site calls this inline in render - so
   * returning a fresh closure meant tearing down and re-adding every subscription
   * on every render. Caching here fixes all ~40 call sites at once, and cannot be
   * forgotten by a new one.
   *
   * The cached closures hold no listener state (they read `this.listeners` on
   * each call), so they stay valid across `reset()`.
   */
  private subscribeFns: Map<string, (listener: () => void) => () => void> =
    new Map();
  subscribe(
    type: "source",
    path: ModuleFilePath,
  ): (listener: () => void) => () => void;
  subscribe(
    type: "sources",
    paths: ModuleFilePath[],
  ): (listener: () => void) => () => void;
  subscribe(
    type: "render",
    path: ModuleFilePath,
  ): (listener: () => void) => () => void;
  subscribe(type: "all-sources"): (listener: () => void) => () => void;
  subscribe(type: "all-renders"): (listener: () => void) => () => void;
  subscribe(type: "auto-publish"): (listener: () => void) => () => void;
  subscribe(type: "parent-ref"): (listener: () => void) => () => void;
  subscribe(type: "pending-ops-count"): (listener: () => void) => () => void;
  subscribe(
    type: "validation-error",
    path: SourcePath,
  ): (listener: () => void) => () => void;
  subscribe(
    type: "all-validation-errors",
  ): (listener: () => void) => () => void;
  subscribe(type: "initialized-at"): (listener: () => void) => () => void;
  subscribe(
    type: "json-entries-progress",
  ): (listener: () => void) => () => void;
  subscribe(
    type: "sync-status",
    path: SourcePath,
  ): (listener: () => void) => () => void;
  subscribe(
    type: "global-transient-errors",
  ): (listener: () => void) => () => void;
  subscribe(type: "network-error"): (listener: () => void) => () => void;
  subscribe(type: "schema-error"): (listener: () => void) => () => void;
  subscribe(
    type: "global-server-side-patch-ids",
  ): (listener: () => void) => () => void;
  subscribe(
    type: "pending-client-side-patch-ids",
  ): (listener: () => void) => () => void;
  subscribe(
    type: "synced-server-side-patch-ids",
  ): (listener: () => void) => () => void;
  subscribe(
    type: "saved-server-side-patch-ids",
  ): (listener: () => void) => () => void;
  subscribe(type: "publish-disabled"): (listener: () => void) => () => void;
  subscribe(type: "published"): (listener: () => void) => () => void;
  subscribe(type: "schema-out-of-date"): (listener: () => void) => () => void;
  subscribe(type: "local-modules-status"): (listener: () => void) => () => void;
  subscribe(type: "schema"): (listener: () => void) => () => void;
  subscribe(type: "patch-sets"): (listener: () => void) => () => void;
  subscribe(type: "all-patches"): (listener: () => void) => () => void;
  subscribe(
    type: "patch-errors",
    path: ModuleFilePath[],
  ): (listener: () => void) => () => void;
  subscribe(
    type: SyncEngineListenerType,
    path?: string | string[],
  ): (listener: () => void) => () => void {
    const paths = Array.isArray(path) ? path : [path || globalNamespace];
    const key = `${type}\u0000${paths.join("\u0001")}`;
    const cached = this.subscribeFns.get(key);
    if (cached) {
      return cached;
    }
    const subscribeFn = (listener: () => void) => {
      // Register a per-subscription wrapper, not `listener` itself. Removal is by
      // identity, and the caller's identity is not unique to a subscription:
      // subscribing the SAME callback twice - once to `a`, again to `[a, b]` -
      // puts one function into the `a` bucket twice, where a Set collapses it to
      // a single entry and the first unsubscribe silences the other too.
      const registered = () => listener();
      for (const p of paths) {
        this.listenersAt(type, p).add(registered);
      }
      return () => {
        // Remove by identity, never by an index captured at subscribe time:
        // unsubscribing is not ordered, so a stored index would detach an
        // unrelated component's listener and it would silently stop rendering.
        for (const p of paths) {
          this.listeners[type]?.[p]?.delete(registered);
        }
      };
    };
    this.subscribeFns.set(key, subscribeFn);
    return subscribeFn;
  }

  private listenersAt(
    type: SyncEngineListenerType,
    path: string,
  ): Set<() => void> {
    let byPath = this.listeners[type];
    if (!byPath) {
      byPath = {};
      this.listeners[type] = byPath;
    }
    let listeners = byPath[path];
    if (!listeners) {
      listeners = new Set();
      byPath[path] = listeners;
    }
    return listeners;
  }

  private emit(listeners?: Set<() => void>) {
    if (listeners) {
      // Iterate a copy: a listener is free to unsubscribe (React does exactly
      // that when a re-render unmounts the subscriber), and mutating the set
      // while iterating it would skip the listeners after it.
      for (const listener of [...listeners]) {
        listener();
      }
    }
  }

  // TODO: remove this (used for manual testing)
  public setCommitSha(sha: string | null) {
    this.commitSha = sha;
  }

  // #region Invalidate
  private invalidateInitializedAt() {
    this.cachedInitializedAtSnapshot = null;
    this.emit(this.listeners["initialized-at"]?.[globalNamespace]);
  }

  private invalidateJsonEntriesProgress() {
    this.cachedJsonEntriesProgressSnapshot = null;
    this.emit(this.listeners["json-entries-progress"]?.[globalNamespace]);
  }

  private invalidateSource(moduleFilePath: ModuleFilePath) {
    if (this.cachedSourceSnapshots !== null) {
      this.cachedSourceSnapshots = {
        ...this.cachedSourceSnapshots,
        [moduleFilePath]: undefined,
      };
    }
    if (this.cachedServerSourceSnapshots !== null) {
      this.cachedServerSourceSnapshots = {
        ...this.cachedServerSourceSnapshots,
        [moduleFilePath]: undefined,
      };
    }
    if (this.cachedBaseSourceSnapshots !== null) {
      this.cachedBaseSourceSnapshots = {
        ...this.cachedBaseSourceSnapshots,
        [moduleFilePath]: undefined,
      };
    }
    // Drop the patched-source cache entry for this module so the next read
    // recomputes from the (possibly updated) serverSources + patch chain.
    this.invalidatePatchedSourcesCache(moduleFilePath);
    this.cachedAllSourcesSnapshot = null;
    this.cachedSourcesSnapshot = null;
    // Cross-module keyof:check-keys / router:check-route errors are resolved
    // at read time against the source snapshot — drop the cache so the next
    // read re-resolves with the updated source without waiting for the
    // worker round-trip.
    this.cachedValidationErrors = null;
    this.emit(this.listeners["sources"]?.[moduleFilePath]);
    this.emit(this.listeners["source"]?.[moduleFilePath]);
    this.emit(this.listeners["all-sources"]?.[globalNamespace]);
    this.emit(this.listeners["all-validation-errors"]?.[globalNamespace]);
    // Renders are computed FROM the source (see computeRender), so a source that
    // moved has renders that moved with it — including a `.jsonValues()` entry
    // that just finished loading, whose row can now render for real.
    this.invalidateRenders(moduleFilePath);
    // The host app's client components read through the overlay, so they need the
    // new source too — see scheduleOverlayEmit.
    this.scheduleOverlayEmit(moduleFilePath);
  }

  // #region Overlay
  /** Modules whose new source the overlay has not been told about yet. */
  private pendingOverlayEmits: Set<ModuleFilePath> = new Set();
  private overlayEmitTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Tells the host app's overlay that a module's source moved, so its client
   * components re-render with the PATCHED view — what the editor is actually
   * looking at, rather than what is committed.
   *
   * Debounced, because the trigger is `invalidateSource`: that fires on every
   * keystroke-patch and once per landing json-entry batch, and each emission
   * clones a whole module source and re-renders every subscribed client
   * component. One emission per burst is enough — the host already throttles its
   * own `router.refresh()` to 500ms.
   */
  private scheduleOverlayEmit(moduleFilePath: ModuleFilePath): void {
    if (!this.overlayEmitter) {
      return;
    }
    this.pendingOverlayEmits.add(moduleFilePath);
    if (this.overlayEmitTimeout !== null) {
      return;
    }
    this.overlayEmitTimeout = setTimeout(() => {
      this.overlayEmitTimeout = null;
      const moduleFilePaths = Array.from(this.pendingOverlayEmits);
      this.pendingOverlayEmits.clear();
      for (const path of moduleFilePaths) {
        this.emitOverlaySource(path);
      }
    }, OVERLAY_EMIT_DEBOUNCE_MS);
  }

  private emitOverlaySource(moduleFilePath: ModuleFilePath): void {
    const patched = this.getPatchedSource(moduleFilePath);
    if (patched === undefined) {
      return;
    }
    // A `.jsonValues()` entry the user has edited but never opened this session
    // is still a marker here, so the overlay would fall back to the committed
    // content and the edit would look lost. Load those; the batch landing
    // invalidates the source again and this runs once more with real content.
    this.requestDraftedJsonEntries(moduleFilePath);
    // Cloned: this is the engine's cached patched source, and handing the host
    // app a live reference to it invites action at a distance.
    this.overlayEmitter?.(moduleFilePath, deepClone(patched));
  }

  /**
   * Requests the content of any `.jsonValues()` entry that a pending patch
   * touches but that is not loaded yet. Cheap: the key set comes from the patch
   * ops, and the engine skips keys it already has.
   */
  private requestDraftedJsonEntries(moduleFilePath: ModuleFilePath): void {
    const baseSource = this.serverSources?.[moduleFilePath];
    if (
      baseSource === undefined ||
      baseSource === null ||
      typeof baseSource !== "object" ||
      Array.isArray(baseSource)
    ) {
      return;
    }
    const keys = new Set<string>();
    for (const patchId of this.orderedPatchIdsForModule(moduleFilePath)) {
      for (const op of this.patchDataByPatchId[patchId]?.patch ?? []) {
        const key = op.op !== "file" ? op.path[0] : undefined;
        if (key !== undefined && Internal.isJson(baseSource[key])) {
          keys.add(key);
        }
      }
    }
    if (keys.size > 0) {
      this.requestJsonEntries(moduleFilePath, Array.from(keys));
    }
  }
  // #endregion Overlay

  private invalidatePatchErrors(moduleFilePath: ModuleFilePath) {
    this.cachedPatchErrorsSnapshot = null;
    this.emit(this.listeners["patch-errors"]?.[moduleFilePath]);
  }

  private invalidateRenders(moduleFilePath: ModuleFilePath) {
    if (this.cachedSourceSnapshots === null) {
      this.cachedSourceSnapshots = {};
    }
    this.cachedRenderSnapshots = {
      ...this.cachedRenderSnapshots,
      // undefined = "recompute on next read"; see getRenderSnapshot.
      [moduleFilePath]: undefined,
    };
    this.cachedAllRendersSnapshot = null;
    this.emit(this.listeners["render"]?.[moduleFilePath]);
    this.emit(this.listeners["all-renders"]?.[globalNamespace]);
  }

  private invalidateSyncStatus(sourcePath: SourcePath | ModuleFilePath) {
    this.cachedSyncStatus = {
      ...this.cachedSyncStatus,
      [sourcePath]: undefined,
    };
    this.emit(this.listeners["sync-status"]?.[sourcePath]);
  }
  private invalidateValidationError(sourcePath: SourcePath) {
    this.emit(this.listeners["validation-error"]?.[sourcePath]);
  }
  private invalidateAllValidationErrors() {
    // TODO: ugly - we need to do this to make sure we get new references across the board
    this.cachedValidationErrors = null;
    this.emit(this.listeners["all-validation-errors"]?.[globalNamespace]);
  }
  private invalidateGlobalTransientErrors() {
    this.cachedGlobalTransientErrorSnapshot = null;
    this.emit(this.listeners["global-transient-errors"]?.[globalNamespace]);
  }
  private invalidateNetworkError() {
    // NOTE: normally we invalidate by setting to null, but network error can be null as well
    this.cachedNetworkErrorSnapshot = undefined;
    this.emit(this.listeners["network-error"]?.[globalNamespace]);
  }
  private invalidateSchemaError() {
    // NOTE: normally we invalidate by setting to null, but schema error can be null as well
    this.cachedSchemaErrorSnapshot = undefined;
    this.emit(this.listeners["schema-error"]?.[globalNamespace]);
  }
  private invalidatePatchSets() {
    this.cachedSerializedPatchSetsSnapshot = null;
    this.emit(this.listeners["patch-sets"]?.[globalNamespace]);
  }
  private invalidatePublishCount() {
    // publishCount is a plain number, so there is no cached snapshot to clear
    this.emit(this.listeners["published"]?.[globalNamespace]);
  }
  private invalidatePendingOps() {
    this.cachedPendingOpsCountSnapshot = null;
    this.emit(this.listeners["pending-ops-count"]?.[globalNamespace]);
  }

  private invalidateAllPatches() {
    this.cachedPatchData = null;
    this.emit(this.listeners["all-patches"]?.[globalNamespace]);
  }

  private invalidateSchema() {
    this.cachedAllSchemasSnapshot = null;
    this.cachedDeserializedSchemas = null;
    this.cachedSchemaSnapshots = null;
    this.cachedAllSourcesSnapshot = null;
    this.emit(this.listeners["schema"]?.[globalNamespace]);
    this.invalidateAllValidationErrors();
    for (const sourcePathS in this.listeners?.["validation-error"] || {}) {
      const sourcePath = sourcePathS as SourcePath;
      this.invalidateValidationError(sourcePath);
    }
  }

  private invalidateParentRef() {
    this.cachedParentRef = undefined;
    this.emit(this.listeners["parent-ref"]?.[globalNamespace]);
  }

  private invalidateGlobalServerSidePatchIds() {
    this.cachedGlobalServerSidePatchIdsSnapshot = null;
    this.invalidateParentRef();
    this.emit(
      this.listeners["global-server-side-patch-ids"]?.[globalNamespace],
    );
  }

  private invalidatePendingClientSidePatchIds() {
    this.cachedPendingClientSidePatchIdsSnapshot = null;
    this.emit(
      this.listeners["pending-client-side-patch-ids"]?.[globalNamespace],
    );
  }

  private invalidateSyncedServerSidePatchIds() {
    this.cachedSyncedServerSidePatchIdsSnapshot = null;
    this.emit(
      this.listeners["synced-server-side-patch-ids"]?.[globalNamespace],
    );
  }

  private invalidateSavedServerSidePatchIds() {
    this.cachedSavedServerSidePatchIdsSnapshot = null;
    this.invalidateParentRef();
    this.emit(this.listeners["saved-server-side-patch-ids"]?.[globalNamespace]);
  }

  private invalidatePublishDisabled() {
    this.cachedPublishDisabledSnapshot = null;
    this.emit(this.listeners["publish-disabled"]?.[globalNamespace]);
  }

  private invalidateSchemaOutOfDate() {
    this.cachedSchemaOutOfDateSnapshot = null;
    this.emit(this.listeners["schema-out-of-date"]?.[globalNamespace]);
  }

  private invalidateLocalModulesStatus() {
    this.cachedLocalModulesStatusSnapshot = null;
    this.emit(this.listeners["local-modules-status"]?.[globalNamespace]);
  }

  private invalidateAutoPublish() {
    this.cachedAutoPublishSnapshot = null;
    this.emit(this.listeners["auto-publish"]?.[globalNamespace]);
  }

  // #region Snapshot

  private cachedSchemaSnapshots: Record<
    SourcePath | ModuleFilePath,
    | {
        status: "success";
        data: SerializedSchema;
      }
    | {
        status: "no-schemas";
        message?: string;
      }
    | {
        status: "module-schema-not-found";
        message?: string;
      }
  > | null;
  getSchemaSnapshot(sourcePath: ModuleFilePath) {
    if (this.cachedSchemaSnapshots === null) {
      this.cachedSchemaSnapshots = {};
    }
    if (this.cachedSchemaSnapshots[sourcePath] === undefined) {
      if (!this.schemas) {
        this.cachedSchemaSnapshots[sourcePath] = {
          status: "no-schemas",
        };
      } else {
        const schemaAtPath = this.schemas[sourcePath];
        if (!schemaAtPath) {
          this.cachedSchemaSnapshots[sourcePath] = {
            status: "module-schema-not-found",
          };
        } else {
          this.cachedSchemaSnapshots[sourcePath] = {
            status: "success",
            data: deepClone(schemaAtPath),
          };
        }
      }
    }
    return this.cachedSchemaSnapshots[sourcePath];
  }

  private cachedRenderSnapshots: Record<
    ModuleFilePath,
    ReifiedRender | null | undefined
  > | null;
  getRenderSnapshot(moduleFilePath: ModuleFilePath): ReifiedRender | null {
    if (this.cachedRenderSnapshots === null) {
      this.cachedRenderSnapshots = {};
    }
    const cached = this.cachedRenderSnapshots[moduleFilePath];
    // `undefined` means "not computed", `null` means "computed: nothing to
    // render". Conflating them would re-run every module's `select` on every
    // read, which for a large record is O(entries) per render pass.
    if (cached !== undefined) {
      return cached;
    }
    const computed =
      this.computeRender(moduleFilePath) ??
      this.renders?.[moduleFilePath] ??
      null;
    this.cachedRenderSnapshots[moduleFilePath] = computed;
    return computed;
  }

  /**
   * Renders a module from the user's own schema INSTANCE against the PATCHED
   * source — which is the whole point: `select` is a user function that only the
   * instance carries, and running it on the patched source means a row's title
   * updates as the user types, something the server render path could never do.
   *
   * Returns null when there is nothing to compute from (no instances, because the
   * host app does not render `<ValModulesClient>`; or no source yet), and the
   * caller falls back to whatever the server sent.
   *
   * Lazy + cached by `cachedRenderSnapshots`: `invalidateSource` drops the cache
   * entry, so this recomputes on the next read rather than on every patch.
   */
  private computeRender(
    moduleFilePath: ModuleFilePath,
  ): ReifiedRender | undefined {
    const instance = this.localSchemaInstances?.[moduleFilePath];
    if (!instance) {
      return undefined;
    }
    const source = this.getPatchedSource(moduleFilePath);
    if (source === undefined) {
      return undefined;
    }
    try {
      return instance["executeRender"](
        moduleFilePath,
        source as SelectorSource,
      );
    } catch (e) {
      // A render is decoration: a schema whose render throws at the module level
      // must not take the module's fields down with it.
      console.error("Val: could not render module", moduleFilePath, e);
      return undefined;
    }
  }

  /**
   * Ordered list of patch ids that touch `moduleFilePath`, in the order they
   * must be applied: confirmed server-side first, then saved-but-not-yet-
   * confirmed, then pending client patches. Filters out ids missing from
   * `patchDataByPatchId` (data not yet loaded) — those are skipped by
   * `getPatchedSource` rather than treated as a gap.
   */
  private orderedPatchIdsForModule(moduleFilePath: ModuleFilePath): PatchId[] {
    const out: PatchId[] = [];
    const known = this.patchIdsByModuleFilePath.get(moduleFilePath);
    if (!known || known.size === 0) return out;
    const push = (id: PatchId) => {
      if (known.has(id) && this.patchDataByPatchId[id]) out.push(id);
    };
    if (this.globalServerSidePatchIds) {
      for (const id of this.globalServerSidePatchIds) push(id);
    }
    for (const id of this.savedButNotYetGlobalServerSidePatchIds) push(id);
    for (const id of this.pendingClientPatchIds) push(id);
    return out;
  }

  /**
   * Computes (and caches) the patched view of `moduleFilePath`. Returns
   * `undefined` if we have no un-patched source yet.
   *
   * The cache stores the ordered patch ids that produced the cached result.
   * On read, if the next ordered list extends the cached one (the cached
   * `patchIds` is a strict prefix), only the new tail is applied on top of
   * the cached source — the common case when a fresh patch is appended.
   * Otherwise we rebuild from `serverSources`, which covers patch deletion,
   * server-side reorder, and any other non-append change.
   */
  /**
   * Lazily loads the content of a single `.jsonValues()` entry and folds it into
   * the source view (re-rendering subscribers). No-op if the entry is already
   * loaded or a load is in flight. Called by the field hooks when the Studio
   * renders a path that descends into an un-loaded json marker.
   *
   * COALESCED: every call in the same tick becomes ONE `/json` request per
   * module. That matters because a record list renders a `<Preview>` per key and
   * each one asks for its own entry — before coalescing, opening a record with
   * N entries fired N requests.
   */
  requestJsonEntry(moduleFilePath: ModuleFilePath, key: string): void {
    this.coalesceJsonEntryRequests(moduleFilePath, [key]);
  }

  /**
   * Queues keys for the next coalesced flush. The flush is a microtask, so all
   * the field effects of one render pass land in a single request per module.
   */
  private coalesceJsonEntryRequests(
    moduleFilePath: ModuleFilePath,
    keys: string[],
  ): void {
    let pending = this.pendingJsonEntryRequests.get(moduleFilePath);
    if (pending === undefined) {
      pending = new Set();
      this.pendingJsonEntryRequests.set(moduleFilePath, pending);
    }
    for (const key of keys) {
      pending.add(key);
    }
    if (this.jsonEntryFlushScheduled) {
      return;
    }
    this.jsonEntryFlushScheduled = true;
    queueMicrotask(() => {
      this.jsonEntryFlushScheduled = false;
      const requests = Array.from(
        this.pendingJsonEntryRequests,
        ([path, requestedKeys]) => ({
          moduleFilePath: path,
          keys: Array.from(requestedKeys),
        }),
      );
      this.pendingJsonEntryRequests.clear();
      void this.loadJsonEntriesSettled(requests);
    });
  }

  /**
   * Maps an entry key as it appears in the PATCHED source back to the key it
   * has in the committed base source, by undoing pending whole-entry renames.
   *
   * `/json` can only resolve keys that exist in the committed source, so a
   * pending rename would 404 on the new key. Loading the content under the
   * BASE key instead is also what makes it render: `applyJsonEntryContents`
   * substitutes into the base source, and the `move` patch then relocates the
   * content to the new key on its own.
   */
  private resolveBaseJsonEntryKey(
    moduleFilePath: ModuleFilePath,
    key: string,
  ): string {
    const baseSource = this.serverSources?.[moduleFilePath];
    if (
      baseSource === undefined ||
      baseSource === null ||
      typeof baseSource !== "object" ||
      Array.isArray(baseSource) ||
      key in baseSource
    ) {
      return key;
    }
    // Walk the pending ops newest-first, undoing renames until we land on a key
    // the base source actually has.
    const patchIds = this.orderedPatchIdsForModule(moduleFilePath);
    let current = key;
    for (let i = patchIds.length - 1; i >= 0; i--) {
      const patchData = this.patchDataByPatchId[patchIds[i]];
      if (!patchData) {
        continue;
      }
      const ops = patchData.patch;
      for (let j = ops.length - 1; j >= 0; j--) {
        const op = ops[j];
        if (
          (op.op === "move" || op.op === "copy") &&
          op.path.length === 1 &&
          op.path[0] === current &&
          op.from.length === 1
        ) {
          current = op.from[0];
          if (current in baseSource) {
            return current;
          }
          break;
        }
      }
    }
    return current;
  }

  /**
   * Resolves once a `.jsonValues()` entry's content is loaded — or immediately
   * if it already is, or if its load previously failed. Awaited before emitting
   * a patch that moves a whole entry, so the patch carries real content rather
   * than an opaque marker. {@link requestJsonEntry} is the fire-and-forget
   * variant used by the field hooks.
   */
  async ensureJsonEntry(
    moduleFilePath: ModuleFilePath,
    requestedKey: string,
  ): Promise<void> {
    await this.loadJsonEntriesSettled([
      { moduleFilePath, keys: [requestedKey] },
    ]);
  }

  /**
   * The committed entry keys of a `.jsonValues()` module — i.e. the keys whose
   * base-source value is still a lazy `{_type:"json"}` marker. `null` when the
   * module's source is not (yet) a record.
   *
   * Keys that exist ONLY in a pending patch are deliberately excluded: they have
   * no committed content to fetch (their value is the patch's own), so asking
   * `/json` for them would 404 and poison them with an error state.
   */
  private committedJsonEntryKeys(
    moduleFilePath: ModuleFilePath,
  ): string[] | null {
    const baseSource = this.serverSources?.[moduleFilePath];
    if (
      baseSource === undefined ||
      baseSource === null ||
      typeof baseSource !== "object" ||
      Array.isArray(baseSource)
    ) {
      return null;
    }
    return Object.keys(baseSource).filter((key) =>
      Internal.isJson(baseSource[key]),
    );
  }

  /**
   * Loads the content of an explicit set of `.jsonValues()` entries, batched.
   * Fire-and-forget: this is what a virtualized list calls for the window it just
   * rendered. Already-loaded, in-flight and previously-failed keys are skipped,
   * so re-rendering the same window costs nothing.
   */
  requestJsonEntries(moduleFilePath: ModuleFilePath, keys: string[]): void {
    this.coalesceJsonEntryRequests(moduleFilePath, keys);
  }

  /**
   * Resolves once EVERY committed entry of the given modules is loaded (or has
   * failed). This is the completeness-critical variant: the reference guards and
   * search must not answer from a partially-loaded record, so they await this and
   * read `complete`.
   *
   * Never called on Studio boot — only when something is about to need the
   * content (a destructive action's reference check, a search query, or an
   * explicit "validate everything").
   */
  async ensureJsonEntries(moduleFilePaths: ModuleFilePath[]): Promise<{
    /** True when every requested key resolved to content. */
    complete: boolean;
    errors: { moduleFilePath: ModuleFilePath; key: string; message: string }[];
  }> {
    return this.loadJsonEntriesSettled(
      moduleFilePaths.map((moduleFilePath) => ({
        moduleFilePath,
        keys: this.committedJsonEntryKeys(moduleFilePath) ?? [],
      })),
    );
  }

  /**
   * The synchronous question a reference guard asks on every render: is every
   * committed entry of these modules loaded and fresh RIGHT NOW?
   * {@link ensureJsonEntries} is how a caller gets there; this is how the UI
   * reads the answer without keeping its own copy of it — a copy would go stale
   * the moment a publish invalidates an entry, and a guard holding a stale
   * "complete" is the defect this phase exists to fix.
   *
   * `error` outranks `incomplete`: a failed entry cannot be waited out, so the
   * guard must stay blocked and offer a retry rather than spin forever.
   */
  getJsonEntriesLoadStatus(moduleFilePaths: ModuleFilePath[]): {
    status: "complete" | "incomplete" | "error";
    errors: { moduleFilePath: ModuleFilePath; key: string; message: string }[];
  } {
    const errors: {
      moduleFilePath: ModuleFilePath;
      key: string;
      message: string;
    }[] = [];
    let incomplete = false;
    for (const moduleFilePath of moduleFilePaths) {
      if (this.serverSources?.[moduleFilePath] === undefined) {
        // The module's source has not been synced yet, so its key set is unknown
        // and we cannot claim its entries are loaded. Transient — boot loads every
        // module's source.
        incomplete = true;
        continue;
      }
      const committed = this.committedJsonEntryKeys(moduleFilePath);
      if (committed === null) {
        // The source IS here, it just is not a record to enumerate — a nullable
        // jsonValues record whose value is null. It has no entries, so it
        // contributes nothing; reporting `incomplete` would freeze every guard at
        // "checking references" with no way forward.
        continue;
      }
      for (const key of committed) {
        const loadingKey = `${moduleFilePath}\0${key}`;
        // In flight FIRST: a refetch (e.g. the post-publish refresh) clears the
        // stale flag when it starts, so an entry being reloaded looks fresh here
        // while it still holds pre-publish content. Ignoring that would hand a
        // guard a "complete" answer computed from content we already know is out
        // of date.
        if (this.loadingJsonEntries.has(loadingKey)) {
          incomplete = true;
          continue;
        }
        const message = this.jsonEntryErrors[moduleFilePath]?.[key];
        if (message !== undefined) {
          errors.push({ moduleFilePath, key, message });
          continue;
        }
        if (
          this.jsonEntryContents[moduleFilePath]?.[key] === undefined ||
          this.staleJsonEntries.has(loadingKey)
        ) {
          incomplete = true;
        }
      }
    }
    if (errors.length > 0) {
      return { status: "error", errors };
    }
    return { status: incomplete ? "incomplete" : "complete", errors };
  }

  /**
   * Clears the memoized failures of these modules' entries and loads them again
   * — the retry behind a blocked reference guard. Whole-module, because that is
   * the unit a guard needs: the point is to get back to `complete`.
   */
  async retryJsonEntries(moduleFilePaths: ModuleFilePath[]): Promise<{
    complete: boolean;
    errors: { moduleFilePath: ModuleFilePath; key: string; message: string }[];
  }> {
    for (const moduleFilePath of moduleFilePaths) {
      delete this.jsonEntryErrors[moduleFilePath];
      // Emit even if the reload turns out to have nothing to fetch (an entry can
      // hold both content and a failed refetch): otherwise the caller keeps
      // rendering the error state it just cleared.
      this.invalidateSource(moduleFilePath);
    }
    return this.ensureJsonEntries(moduleFilePaths);
  }

  /**
   * Loads `requests` and re-passes while anything it asked for is still
   * outstanding, then reports whether everything resolved to content.
   *
   * The re-pass exists because an invalidation that lands mid-flight marks
   * entries stale again: the response we were waiting for predates it, so
   * reporting `complete` on the strength of it would be exactly the lie this
   * method exists to prevent. Bounded, so a pathological invalidation loop
   * cannot spin here forever.
   */
  private async loadJsonEntriesSettled(
    requests: { moduleFilePath: ModuleFilePath; keys: string[] }[],
  ): Promise<{
    complete: boolean;
    errors: { moduleFilePath: ModuleFilePath; key: string; message: string }[];
  }> {
    let errors: {
      moduleFilePath: ModuleFilePath;
      key: string;
      message: string;
    }[] = [];
    let outstanding = false;
    for (let pass = 0; pass < JSON_ENTRIES_MAX_LOAD_PASSES; pass++) {
      const res = await this.loadJsonEntries(requests);
      errors = res.errors;
      outstanding = res.requestedBaseKeys.some(({ moduleFilePath, keys }) =>
        keys.some((key) => {
          if (this.staleJsonEntries.has(`${moduleFilePath}\0${key}`)) {
            return true;
          }
          return (
            this.jsonEntryContents[moduleFilePath]?.[key] === undefined &&
            this.jsonEntryErrors[moduleFilePath]?.[key] === undefined
          );
        }),
      );
      if (!outstanding) {
        break;
      }
    }
    if (outstanding) {
      // Reported so "incomplete for no stated reason" is diagnosable: the bound is
      // a backstop against an invalidation loop, not a computed limit, and hitting
      // it means something kept re-invalidating faster than we could load.
      console.error(
        `Val: SyncEngine: json entries still outstanding after ${JSON_ENTRIES_MAX_LOAD_PASSES} load passes`,
        { requests },
      );
      return { complete: false, errors };
    }
    return { complete: errors.length === 0, errors };
  }

  /**
   * ONE load pass: filters each module's requested keys down to the ones worth
   * fetching, chunks them, and resolves when every chunk has settled. Reports the
   * keys it actually took responsibility for, so the caller can tell "resolved"
   * from "deliberately skipped".
   */
  private async loadJsonEntries(
    requests: { moduleFilePath: ModuleFilePath; keys: string[] }[],
  ): Promise<{
    errors: { moduleFilePath: ModuleFilePath; key: string; message: string }[];
    requestedBaseKeys: { moduleFilePath: ModuleFilePath; keys: string[] }[];
  }> {
    const waits: Promise<void>[] = [];
    const requestedBaseKeys: {
      moduleFilePath: ModuleFilePath;
      keys: string[];
    }[] = [];
    for (const { moduleFilePath, keys } of requests) {
      const committed = this.committedJsonEntryKeys(moduleFilePath);
      if (committed === null) {
        continue;
      }
      const committedKeys = new Set(committed);
      const patchedSource = this.getPatchedSource(moduleFilePath);
      const draftedKeys =
        patchedSource !== undefined &&
        patchedSource !== null &&
        typeof patchedSource === "object" &&
        !Array.isArray(patchedSource)
          ? new Set(Object.keys(patchedSource))
          : new Set<string>();
      const baseKeys: string[] = [];
      const wanted: string[] = [];
      const seen = new Set<string>();
      for (const requestedKey of keys) {
        const key = this.resolveBaseJsonEntryKey(moduleFilePath, requestedKey);
        if (seen.has(key)) {
          continue;
        }
        // A key the committed source does not have, but the PATCHED source does,
        // exists only in a pending patch: its value comes from that patch, so
        // there is nothing to fetch and asking would 404 and wrongly mark it
        // errored. A key in neither is a genuine miss and IS requested, so the
        // caller gets a real error instead of silence.
        if (!committedKeys.has(key) && draftedKeys.has(key)) {
          continue;
        }
        seen.add(key);
        baseKeys.push(key);
        const loadingKey = `${moduleFilePath}\0${key}`;
        const inFlight = this.loadingJsonEntries.get(loadingKey);
        if (inFlight !== undefined) {
          waits.push(inFlight);
          continue;
        }
        const isStale = this.staleJsonEntries.has(loadingKey);
        if (isStale) {
          wanted.push(key);
          continue;
        }
        if (this.jsonEntryContents[moduleFilePath]?.[key] !== undefined) {
          continue;
        }
        // A memoized failure stops the refetch loop (see `jsonEntryErrors`);
        // `retryJsonEntry` clears it.
        if (this.jsonEntryErrors[moduleFilePath]?.[key] !== undefined) {
          continue;
        }
        wanted.push(key);
      }
      requestedBaseKeys.push({ moduleFilePath, keys: baseKeys });
      for (let i = 0; i < wanted.length; i += JSON_ENTRIES_CHUNK_SIZE) {
        waits.push(
          this.loadJsonEntryChunk(
            moduleFilePath,
            wanted.slice(i, i + JSON_ENTRIES_CHUNK_SIZE),
          ),
        );
      }
    }
    await Promise.all(waits);
    const errors: {
      moduleFilePath: ModuleFilePath;
      key: string;
      message: string;
    }[] = [];
    for (const { moduleFilePath, keys } of requestedBaseKeys) {
      for (const key of keys) {
        const message = this.jsonEntryErrors[moduleFilePath]?.[key];
        if (message !== undefined) {
          errors.push({ moduleFilePath, key, message });
        }
      }
    }
    return { errors, requestedBaseKeys };
  }

  /** Loads ONE batch of entries: a single `/json` request for many keys. */
  private loadJsonEntryChunk(
    moduleFilePath: ModuleFilePath,
    keys: string[],
  ): Promise<void> {
    const setJsonEntryError = (key: string, message: string) => {
      if (this.jsonEntryErrors[moduleFilePath] === undefined) {
        this.jsonEntryErrors[moduleFilePath] = {};
      }
      this.jsonEntryErrors[moduleFilePath][key] = message;
    };
    // Cleared at request START, not on success: anything that marks an entry
    // stale while this request is in flight must win, since the response we are
    // about to get was produced before that invalidation.
    for (const key of keys) {
      this.staleJsonEntries.delete(`${moduleFilePath}\0${key}`);
    }
    /**
     * True once the key has been marked stale AGAIN, i.e. after the flags above
     * were cleared and thus after this request was issued. Content that predates
     * that invalidation is content the invalidation already knows is wrong, so
     * writing it in would show it — visibly, until the re-pass in
     * {@link loadJsonEntriesSettled} refetches and corrects it.
     *
     * Only content is dropped this way, never a failure: `loadJsonEntries` checks
     * staleness BEFORE the error memo, so recording the error does not stop the
     * refetch — while dropping it could leave the key with neither content nor
     * error, which renders as a spinner with nothing to retry.
     */
    const isOutdatedContent = (key: string) =>
      this.staleJsonEntries.has(`${moduleFilePath}\0${key}`);
    this.noteJsonEntriesRequested(keys.length);
    const promise = this.client("/json", "GET", {
      // apply_patches=false: we own in-flight client patches the server has not
      // seen yet and apply them ourselves in `getPatchedSource`. Letting the
      // server apply them too would double-apply.
      query: {
        path: moduleFilePath,
        key: undefined,
        keys,
        offset: undefined,
        limit: undefined,
        apply_patches: false,
      },
    })
      .then((res) => {
        if (res.status === 200 && "entries" in res.json) {
          if (this.jsonEntryContents[moduleFilePath] === undefined) {
            this.jsonEntryContents[moduleFilePath] = {};
          }
          for (const entry of res.json.entries) {
            if (isOutdatedContent(entry.key)) {
              continue;
            }
            this.jsonEntryContents[moduleFilePath][entry.key] =
              entry.content ?? null;
            if (this.jsonEntryErrors[moduleFilePath] !== undefined) {
              delete this.jsonEntryErrors[moduleFilePath][entry.key];
            }
          }
          // A committed key that the server cannot resolve (deleted on disk
          // between our source sync and this request) is an error, not silence.
          for (const key of res.json.missing) {
            setJsonEntryError(
              key,
              `Entry not found: ${key} in ${moduleFilePath}`,
            );
          }
          for (const { key, message } of res.json.errors) {
            setJsonEntryError(key, message);
          }
        } else {
          const message =
            "message" in res.json
              ? res.json.message
              : `Request failed with status ${res.status}`;
          console.error("Val: SyncEngine: failed to load json entries", {
            moduleFilePath,
            keys,
            res,
          });
          for (const key of keys) {
            setJsonEntryError(key, message);
          }
        }
      })
      .catch((err) => {
        console.error("Val: SyncEngine: error loading json entries", {
          moduleFilePath,
          keys,
          err,
        });
        const message = err instanceof Error ? err.message : String(err);
        for (const key of keys) {
          setJsonEntryError(key, message);
        }
      })
      .finally(() => {
        for (const key of keys) {
          this.loadingJsonEntries.delete(`${moduleFilePath}\0${key}`);
        }
        // ONE invalidation for the whole batch, not one per entry.
        this.invalidateSource(moduleFilePath);
        // After the in-flight deletes above, so "nothing left in flight" is
        // accurate and the run can reset.
        this.noteJsonEntriesResolved(keys.length);
      });
    for (const key of keys) {
      this.loadingJsonEntries.set(`${moduleFilePath}\0${key}`, promise);
    }
    return promise;
  }

  private noteJsonEntriesRequested(count: number): void {
    if (count <= 0) {
      return;
    }
    this.jsonEntriesProgress = {
      requested: this.jsonEntriesProgress.requested + count,
      resolved: this.jsonEntriesProgress.resolved,
    };
    this.invalidateJsonEntriesProgress();
  }

  private noteJsonEntriesResolved(count: number): void {
    if (count <= 0) {
      return;
    }
    const { requested, resolved } = this.jsonEntriesProgress;
    this.jsonEntriesProgress =
      this.loadingJsonEntries.size === 0
        ? // The run is over — reset so the next one starts from 0%.
          { requested: 0, resolved: 0 }
        : { requested, resolved: Math.min(resolved + count, requested) };
    this.invalidateJsonEntriesProgress();
  }

  private cachedJsonEntriesProgressSnapshot: JsonEntriesProgress | null = null;
  /**
   * Progress of the current json-entry load run, for UI that must show it rather
   * than pretend it has a complete answer. Spans every module in flight, so the
   * percentage does not reset at module boundaries.
   */
  getJsonEntriesProgressSnapshot(): JsonEntriesProgress {
    if (this.cachedJsonEntriesProgressSnapshot === null) {
      const { requested, resolved } = this.jsonEntriesProgress;
      this.cachedJsonEntriesProgressSnapshot = {
        status: requested === 0 ? "idle" : "loading",
        loaded: resolved,
        total: requested,
        // 100 while idle: check `status` first if "nothing requested yet" and
        // "everything done" must look different.
        percentage:
          requested === 0 ? 100 : Math.round((resolved / requested) * 100),
      };
    }
    return this.cachedJsonEntriesProgressSnapshot;
  }

  /**
   * The error message of the last failed load of a `.jsonValues()` entry, or
   * `null`. Returns a primitive so it is safe to read from a
   * `useSyncExternalStore` snapshot getter.
   */
  getJsonEntryError(
    moduleFilePath: ModuleFilePath,
    requestedKey: string,
  ): string | null {
    const key = this.resolveBaseJsonEntryKey(moduleFilePath, requestedKey);
    return this.jsonEntryErrors[moduleFilePath]?.[key] ?? null;
  }

  /** Clears a memoized json entry failure and loads it again. */
  retryJsonEntry(moduleFilePath: ModuleFilePath, requestedKey: string): void {
    const key = this.resolveBaseJsonEntryKey(moduleFilePath, requestedKey);
    if (this.jsonEntryErrors[moduleFilePath] !== undefined) {
      delete this.jsonEntryErrors[moduleFilePath][key];
    }
    this.requestJsonEntry(moduleFilePath, key);
    // So the retry is visible immediately: subscribers re-read, see the error is
    // gone and render a loading state instead of the error they just dismissed.
    // Without this nothing changes until the request settles, and a "try again"
    // that looks like it did nothing invites a second click.
    this.invalidateSource(moduleFilePath);
  }

  /**
   * Marks every loaded entry of a module stale, so the next request refetches
   * its committed content. Called when the module's server source is replaced
   * (e.g. after publish): without this the pre-edit content is re-substituted
   * and a published edit looks like it reverted.
   */
  private markJsonEntriesStale(moduleFilePath: ModuleFilePath): void {
    const contents = this.jsonEntryContents[moduleFilePath];
    if (contents === undefined) {
      // Nothing cached to invalidate. Deliberately does NOT clear the error memo:
      // a key that has only ever FAILED has no cached content, so there is no
      // refetch below to replace the error with — and a memo cleared without one
      // renders as a spinner with nothing in flight and nothing to retry.
      return;
    }
    const keys = Object.keys(contents);
    const errors = this.jsonEntryErrors[moduleFilePath];
    for (const key of keys) {
      this.staleJsonEntries.add(`${moduleFilePath}\0${key}`);
      // Cleared per key, and only for the keys the refetch below covers.
      if (errors !== undefined) {
        delete errors[key];
      }
    }
    // Batched: with hundreds of entries cached, refetching one-by-one made a
    // publish a request storm.
    this.requestJsonEntries(moduleFilePath, keys);
  }

  /**
   * `baseSource` with `patchIds` applied in order. A patch that does not apply is
   * skipped, matching {@link getPatchedSource} and the server's own patch
   * analysis. Uncached — for the one-shot reads around a save.
   */
  private applyPatchIdsTo(
    baseSource: JSONValue,
    moduleFilePath: ModuleFilePath,
    patchIds: PatchId[],
  ): JSONValue {
    let current = baseSource;
    for (const patchId of patchIds) {
      const data = this.patchDataByPatchId[patchId];
      if (!data) {
        continue;
      }
      const patchableOps = data.patch.filter((op) => op.op !== "file");
      if (patchableOps.length === 0) {
        continue;
      }
      const patchRes = applyPatch(deepClone(current), ops, patchableOps);
      if (result.isOk(patchRes)) {
        current = patchRes.value;
      } else {
        console.debug("ValSyncEngine: skipping unappliable patch", {
          patchId,
          moduleFilePath,
          message: patchRes.error.message,
        });
      }
    }
    return current;
  }

  /**
   * The module source as a save leaves it on disk: the patch chain applied to the
   * RAW base, markers and all.
   *
   * Markers must survive. A `{_type:"json"}` marker is what tells the engine an
   * entry's value lives in its own file and has to be loaded — and refetched —
   * through `/json`. Baking a source with the content substituted in would inline
   * it over the markers and quietly switch that machinery off: no refetch after a
   * save, and `committedJsonEntryKeys` reporting the module has no entries at all.
   * The ops that reach INSIDE an entry do not apply to a marker, are skipped
   * here, and are exactly the ones
   * {@link foldPublishedJsonEntriesIntoCommitted} has already folded into the
   * entry cache. For a module without markers this is just the patched source.
   */
  private sourceAsSavedToDisk(
    moduleFilePath: ModuleFilePath,
  ): JSONValue | undefined {
    const baseSource = this.serverSources?.[moduleFilePath];
    if (baseSource === undefined) {
      return undefined;
    }
    return this.applyPatchIdsTo(
      baseSource,
      moduleFilePath,
      this.orderedPatchIdsForModule(moduleFilePath),
    );
  }

  /**
   * Folds what the save just wrote to disk into the committed cache of every
   * loaded `.jsonValues()` entry. Called from {@link publish} BEFORE the patch
   * state is dropped: with the patches gone there is nothing left on top to hide
   * a pre-edit cache entry, so the engine's view of the module sits behind the
   * disk until the refetch lands — and the saved edit visibly reverts, then comes
   * back.
   *
   * Applies ONLY `publishedPatchIds`. `publish` is handed the server-side ids, so
   * a pending client patch that has not been PUT yet is NOT on disk; baking it in
   * would double-apply it once the sync delivers it and the server sends it back.
   *
   * Deliberately narrow — it covers the CONTENT edit, which is the case that
   * needs it: a content edit rewrites only the entry's `*.val.json`, so the
   * module source is byte-identical, `sourcesSha` does not change and no
   * `/sources/~` refresh comes to correct the cache. Anything that reshapes the
   * record's keys rewrites the `.val.ts` too and is corrected by the refresh it
   * triggers, so a removed key is left alone and a `move`/`copy` (where two keys
   * can resolve to one cache key) opts the module out entirely.
   */
  private foldPublishedJsonEntriesIntoCommitted(
    publishedPatchIds: PatchId[],
  ): void {
    const published = new Set(publishedPatchIds);
    for (const moduleFilePath of this.patchIdsByModuleFilePath.keys()) {
      const contents = this.jsonEntryContents[moduleFilePath];
      const baseSource = this.serverSources?.[moduleFilePath];
      if (contents === undefined || baseSource === undefined) {
        continue;
      }
      const patchIds = this.orderedPatchIdsForModule(moduleFilePath).filter(
        (patchId) => published.has(patchId),
      );
      if (patchIds.length === 0) {
        continue;
      }
      // A whole-entry move or copy can land a key under a name another key held,
      // which would fold one entry's content onto another's cache slot.
      const reshapesKeys = patchIds.some((patchId) =>
        this.patchDataByPatchId[patchId]?.patch.some(
          (op) =>
            (op.op === "move" || op.op === "copy") &&
            (op.path.length <= 1 || op.from.length <= 1),
        ),
      );
      if (reshapesKeys) {
        continue;
      }
      const current = this.applyPatchIdsTo(
        this.applyJsonEntryContents(moduleFilePath, baseSource),
        moduleFilePath,
        patchIds,
      );
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current)
      ) {
        continue;
      }
      for (const key of Object.keys(contents)) {
        const publishedValue = current[key];
        // Gone from the published source: removed by one of these patches, so
        // there is no on-disk content to fold. That rewrites the module source,
        // so the `/sources/~` refresh corrects the cache.
        if (publishedValue === undefined) {
          continue;
        }
        contents[key] = deepClone(publishedValue);
      }
      // Paired with the mutation, as at every other write to jsonEntryContents:
      // the patched-source cache can hold a source built from the pre-fold
      // content, and it outlives publish because the /patches re-sync brings the
      // module's patch ids back. NOT invalidateSource: that would emit, and a
      // re-read while the patches are still applied would apply them on top of
      // content that already contains them.
      this.invalidatePatchedSourcesCache(moduleFilePath);
    }
  }

  /**
   * Marks every loaded `.jsonValues()` entry of every module stale.
   *
   * Needed on publish: a content-only edit rewrites the entry's `*.val.json`
   * but NOT the `.val.ts`, so the module source (bare `{_type:"json"}` markers)
   * is byte-identical and `sourcesSha` does not change — no `/sources/~`
   * refresh is triggered. Without this the just-published content is served
   * from the pre-edit cache and the edit looks like it reverted.
   */
  private markAllJsonEntriesStale(): void {
    for (const moduleFilePathS of Object.keys(this.jsonEntryContents)) {
      this.markJsonEntriesStale(moduleFilePathS as ModuleFilePath);
    }
  }

  /**
   * Returns `baseSource` with any loaded `.jsonValues()` entry content
   * substituted in place of its lazy marker, so downstream resolution/patching
   * sees real content. Markers without loaded content are left untouched.
   */
  private applyJsonEntryContents(
    moduleFilePath: ModuleFilePath,
    baseSource: JSONValue,
  ): JSONValue {
    const contents = this.jsonEntryContents[moduleFilePath];
    if (
      contents === undefined ||
      baseSource === null ||
      typeof baseSource !== "object" ||
      Array.isArray(baseSource)
    ) {
      return baseSource;
    }
    let result: Record<string, JSONValue> | null = null;
    for (const key in contents) {
      if (Internal.isJson(baseSource[key])) {
        if (result === null) {
          result = { ...baseSource };
        }
        result[key] = contents[key];
      }
    }
    return result ?? baseSource;
  }

  private getPatchedSource(
    moduleFilePath: ModuleFilePath,
  ): JSONValue | undefined {
    const rawBaseSource = this.serverSources?.[moduleFilePath];
    if (rawBaseSource === undefined) return undefined;
    const baseSource = this.applyJsonEntryContents(
      moduleFilePath,
      rawBaseSource,
    );
    const nextIds = this.orderedPatchIdsForModule(moduleFilePath);
    if (nextIds.length === 0) return baseSource;

    if (this.patchedSourcesCache === null) {
      this.patchedSourcesCache = {};
    }
    const cached = this.patchedSourcesCache[moduleFilePath];
    let current: JSONValue;
    let startIndex: number;
    if (cached && this.isPrefix(cached.patchIds, nextIds)) {
      if (cached.source === undefined) return undefined;
      current = cached.source;
      startIndex = cached.patchIds.length;
      if (startIndex === nextIds.length) return current;
    } else {
      current = baseSource as JSONValue;
      startIndex = 0;
    }

    // Track the contiguous, fully-applied prefix so we never cache a source
    // under a patch-id list that includes a skipped (unappliable) patch. Once a
    // patch fails, later patches still apply on top for the returned value, but
    // the cache only remembers the clean prefix — so the failing patch (and the
    // tail) is retried on the next read instead of being treated as applied.
    let appliedPrefixLen = startIndex;
    let appliedPrefixSource = current;
    let prefixIntact = true;
    const clientPatchErrors: Record<PatchId, PatchErrorEntry> = {};
    for (let i = startIndex; i < nextIds.length; i++) {
      const patchId = nextIds[i];
      const data = this.patchDataByPatchId[patchId];
      if (!data) {
        // shouldn't happen — filter in orderedPatchIdsForModule
        prefixIntact = false;
        continue;
      }
      const patchableOps = data.patch.filter((op) => op.op !== "file");
      if (patchableOps.length === 0) {
        // file-only / no-op patch — nothing changes, prefix stays intact
        if (prefixIntact) {
          appliedPrefixLen = i + 1;
          appliedPrefixSource = current;
        }
        continue;
      }
      const patchRes = applyPatch(deepClone(current), ops, patchableOps);
      if (result.isOk(patchRes)) {
        current = patchRes.value;
        if (prefixIntact) {
          appliedPrefixLen = i + 1;
          appliedPrefixSource = current;
        }
      } else {
        // skip a failing patch — don't pollute the cache with the bad state
        prefixIntact = false;
        console.debug("ValSyncEngine: skipping unappliable client-side patch", {
          patchId,
          moduleFilePath,
          message: patchRes.error.message,
        });
        // Skipping silently is how a conflicting change stayed invisible until
        // publish: the view keeps applying later patches on top, so it looks
        // healthy while /save refuses the whole commit. Record it so the studio
        // can show it and offer to remove it.
        clientPatchErrors[patchId] = {
          message: patchRes.error.message,
          source: "client",
        };
      }
    }

    this.patchedSourcesCache[moduleFilePath] = {
      patchIds: nextIds.slice(0, appliedPrefixLen),
      source: appliedPrefixSource,
    };
    this.recordClientPatchErrors(
      moduleFilePath,
      clientPatchErrors,
      nextIds,
      startIndex === 0,
    );
    return current;
  }

  /**
   * Merges the client-side patch failures for a module into `errors.patchErrors`
   * and prunes entries whose patch has left the chain (deleted or published).
   *
   * Server-recorded failures are left alone: a patch can apply client-side with
   * JSONOps and still be rejected by /save, which applies it to the source-file
   * AST, so the client cannot conclude that a server error has gone away.
   *
   * @param replaceExisting the whole chain was re-evaluated (rather than just a
   * newly appended tail), so previously recorded client errors for this module
   * are stale and are dropped.
   */
  private recordClientPatchErrors(
    moduleFilePath: ModuleFilePath,
    clientPatchErrors: Record<PatchId, PatchErrorEntry>,
    patchIdsInChain: PatchId[],
    replaceExisting: boolean,
  ) {
    const previous = this.errors.patchErrors?.[moduleFilePath] ?? null;
    const inChain = new Set<string>(patchIdsInChain);
    const next: Record<PatchId, PatchErrorEntry> = {};
    for (const [patchIdS, entry] of Object.entries(previous ?? {})) {
      const patchId = patchIdS as PatchId;
      if (!inChain.has(patchId)) {
        continue;
      }
      if (replaceExisting && entry.source !== "server") {
        continue;
      }
      next[patchId] = entry;
    }
    for (const [patchIdS, entry] of Object.entries(clientPatchErrors)) {
      next[patchIdS as PatchId] = entry;
    }
    const hasErrors = Object.keys(next).length > 0;
    // Structural, not `JSON.stringify`: key order in these records follows
    // insertion order, so a chain recompute that produces the SAME errors in a
    // different order compared as changed and invalidated for nothing.
    const changed = !deepEqual(previous ?? null, hasErrors ? next : null);
    if (!changed) {
      return;
    }
    if (this.errors.patchErrors === undefined) {
      this.errors.patchErrors = {};
    }
    this.errors.patchErrors[moduleFilePath] = hasErrors ? next : null;
    // This runs inside a snapshot getter (getSourceSnapshot -> getPatchedSource),
    // so emitting here would notify subscribers mid-read. Defer it.
    this.schedulePatchErrorsInvalidation(moduleFilePath);
  }

  /**
   * Records the patches /save could not apply, from its 400 body.
   *
   * @returns how many failures were recorded, so the caller can say something
   * more useful than "Failed to publish changes".
   */
  private recordServerPatchErrors(json: unknown): number {
    if (json === null || typeof json !== "object" || !("details" in json)) {
      return 0;
    }
    const details = json.details;
    if (
      details === null ||
      typeof details !== "object" ||
      !("unappliablePatches" in details) ||
      details.unappliablePatches === null ||
      typeof details.unappliablePatches !== "object"
    ) {
      return 0;
    }
    const byModule = new Map<
      ModuleFilePath,
      Record<PatchId, PatchErrorEntry>
    >();
    for (const [patchIdS, value] of Object.entries(
      details.unappliablePatches,
    )) {
      if (
        value === null ||
        typeof value !== "object" ||
        !("moduleFilePath" in value) ||
        !("message" in value) ||
        typeof value.moduleFilePath !== "string" ||
        typeof value.message !== "string"
      ) {
        continue;
      }
      const moduleFilePath = value.moduleFilePath as ModuleFilePath;
      const entries = byModule.get(moduleFilePath) ?? {};
      entries[patchIdS as PatchId] = {
        message: value.message,
        source: "server",
      };
      byModule.set(moduleFilePath, entries);
    }
    let recorded = 0;
    for (const [moduleFilePath, entries] of Array.from(byModule.entries())) {
      if (this.errors.patchErrors === undefined) {
        this.errors.patchErrors = {};
      }
      this.errors.patchErrors[moduleFilePath] = {
        ...(this.errors.patchErrors[moduleFilePath] ?? {}),
        ...entries,
      };
      recorded += Object.keys(entries).length;
      this.invalidatePatchErrors(moduleFilePath);
    }
    return recorded;
  }

  private schedulePatchErrorsInvalidation(moduleFilePath: ModuleFilePath) {
    if (this.pendingPatchErrorInvalidations === null) {
      this.pendingPatchErrorInvalidations = new Set();
      queueMicrotask(() => {
        const moduleFilePaths = this.pendingPatchErrorInvalidations;
        this.pendingPatchErrorInvalidations = null;
        for (const path of Array.from(moduleFilePaths ?? [])) {
          this.invalidatePatchErrors(path);
        }
      });
    }
    this.pendingPatchErrorInvalidations.add(moduleFilePath);
  }

  private isPrefix(prev: PatchId[], next: PatchId[]): boolean {
    if (prev.length > next.length) return false;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== next[i]) return false;
    }
    return true;
  }

  private invalidatePatchedSourcesCache(moduleFilePath?: ModuleFilePath) {
    if (this.patchedSourcesCache === null) return;
    if (moduleFilePath === undefined) {
      this.patchedSourcesCache = null;
    } else {
      this.patchedSourcesCache = {
        ...this.patchedSourcesCache,
        [moduleFilePath]: undefined,
      };
    }
  }

  private cachedSourceSnapshots: Record<
    ModuleFilePath,
    | {
        status: "success";
        data: Json;
      }
    | {
        data?: undefined;
        status: "no-schemas" | "source-not-found" | "schema-not-found";
        message?: string;
      }
  > | null;
  /**
   * The patched source of a module.
   *
   * Cached per MODULE, not per subscriber: this deep-clones the whole module, so
   * a cache key that also varied by the calling component made one keystroke cost
   * one full clone of the module PER MOUNTED FIELD. Whether a given component was
   * the last to edit the module is a cheap, separate question - ask
   * {@link isOptimisticFor}.
   */
  getSourceSnapshot(sourcePath: ModuleFilePath) {
    if (this.cachedSourceSnapshots === null) {
      this.cachedSourceSnapshots = {};
    }
    if (this.cachedSourceSnapshots[sourcePath] === undefined) {
      const moduleData = this.getPatchedSource(sourcePath);
      if (this.schemas === null) {
        this.cachedSourceSnapshots[sourcePath] = {
          status: "no-schemas",
        };
      } else if (!this.schemas[sourcePath]) {
        this.cachedSourceSnapshots[sourcePath] = {
          status: "schema-not-found",
        };
      } else if (moduleData === undefined) {
        this.cachedSourceSnapshots[sourcePath] = {
          status: "source-not-found",
        };
      } else {
        this.cachedSourceSnapshots[sourcePath] = {
          status: "success",
          data: deepClone(moduleData),
        };
      }
    }
    return this.cachedSourceSnapshots[sourcePath];
  }

  /**
   * Whether `creatorId` created the most recent patch on this module - i.e. the
   * module's current value is this component's own optimistic edit, so pushing
   * the engine value back at it would clobber what the user is typing.
   *
   * Cheap: a few array-tail comparisons, no cloning. Read it alongside
   * {@link getSourceSnapshot} rather than baking it into the cached snapshot.
   */
  isOptimisticFor(moduleFilePath: ModuleFilePath, creatorId?: string): boolean {
    return this.isEditedByComponent(moduleFilePath, creatorId);
  }

  private cachedServerSourceSnapshots: Record<
    ModuleFilePath,
    | { status: "success"; data: Json }
    | { status: "no-schemas" | "source-not-found" | "schema-not-found" }
  > | null;
  getServerSourceSnapshot(
    sourcePath: ModuleFilePath,
  ):
    | { status: "success"; data: Json }
    | { status: "no-schemas" | "source-not-found" | "schema-not-found" } {
    if (this.cachedServerSourceSnapshots === null) {
      this.cachedServerSourceSnapshots = {};
    }
    if (this.cachedServerSourceSnapshots[sourcePath] === undefined) {
      if (this.schemas === null) {
        this.cachedServerSourceSnapshots[sourcePath] = {
          status: "no-schemas",
        };
      } else if (!this.schemas[sourcePath]) {
        this.cachedServerSourceSnapshots[sourcePath] = {
          status: "schema-not-found",
        };
      } else {
        const moduleData = this.serverSources?.[sourcePath];
        if (moduleData === undefined) {
          this.cachedServerSourceSnapshots[sourcePath] = {
            status: "source-not-found",
          };
        } else {
          this.cachedServerSourceSnapshots[sourcePath] = {
            status: "success",
            data: deepClone(moduleData),
          };
        }
      }
    }
    return this.cachedServerSourceSnapshots[sourcePath];
  }

  private cachedBaseSourceSnapshots: Record<
    ModuleFilePath,
    | { status: "success"; data: Json }
    | { status: "no-schemas" | "source-not-found" | "schema-not-found" }
  > | null;
  getBaseSourceSnapshot(
    sourcePath: ModuleFilePath,
  ):
    | { status: "success"; data: Json }
    | { status: "no-schemas" | "source-not-found" | "schema-not-found" } {
    if (this.cachedBaseSourceSnapshots === null) {
      this.cachedBaseSourceSnapshots = {};
    }
    if (this.cachedBaseSourceSnapshots[sourcePath] === undefined) {
      if (this.schemas === null) {
        this.cachedBaseSourceSnapshots[sourcePath] = {
          status: "no-schemas",
        };
      } else if (!this.schemas[sourcePath]) {
        this.cachedBaseSourceSnapshots[sourcePath] = {
          status: "schema-not-found",
        };
      } else {
        // With apply_patches=false on /sources/~, serverSources is already
        // the un-patched view — exactly what the compare-view "before" wants.
        const moduleData = this.serverSources?.[sourcePath];
        if (moduleData === undefined) {
          this.cachedBaseSourceSnapshots[sourcePath] = {
            status: "source-not-found",
          };
        } else {
          this.cachedBaseSourceSnapshots[sourcePath] = {
            status: "success",
            data: deepClone(moduleData),
          };
        }
      }
    }
    return this.cachedBaseSourceSnapshots[sourcePath];
  }

  private cachedAllSourcesSnapshot: Record<ModuleFilePath, Json> | null;
  getAllSourcesSnapshot() {
    if (this.cachedAllSourcesSnapshot === null) {
      this.cachedAllSourcesSnapshot = {};
      for (const moduleFilePathS in this.schemas || {}) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        const data = this.getPatchedSource(moduleFilePath);
        if (data !== undefined) {
          this.cachedAllSourcesSnapshot[moduleFilePath] = deepClone(data);
        }
      }
    }
    return this.cachedAllSourcesSnapshot;
  }

  private cachedAllRendersSnapshot: Record<
    ModuleFilePath,
    ReifiedRender | null
  > | null;
  getAllRendersSnapshot(): Record<ModuleFilePath, ReifiedRender | null> {
    if (this.cachedAllRendersSnapshot === null) {
      this.cachedAllRendersSnapshot = {};
      // Every module we have a SCHEMA for, not just the ones the server sent a
      // render for: with client-side instances the render is computed here, and
      // the server sends none (the Studio always asks for apply_patches:false).
      const moduleFilePaths = new Set<ModuleFilePath>([
        ...(Object.keys(this.localSchemaInstances ?? {}) as ModuleFilePath[]),
        ...(Object.keys(this.renders ?? {}) as ModuleFilePath[]),
      ]);
      for (const moduleFilePath of moduleFilePaths) {
        this.cachedAllRendersSnapshot[moduleFilePath] =
          this.getRenderSnapshot(moduleFilePath);
      }
    }
    return this.cachedAllRendersSnapshot;
  }

  private multipleSourcesSep = "|";
  private cachedSourcesSnapshot: Record<string, Json[] | undefined> | null;
  getSourcesSnapshot(paths: ModuleFilePath[]) {
    const pathsKey = paths
      .sort()
      .map((path) => path + this.multipleSourcesSep)
      .join(this.multipleSourcesSep);
    if (this.cachedSourcesSnapshot === null) {
      this.cachedSourcesSnapshot = {};
    }
    if (this.cachedSourcesSnapshot[pathsKey] === undefined) {
      for (const moduleFilePath of paths) {
        const data = this.getPatchedSource(moduleFilePath);
        if (data !== undefined) {
          this.cachedSourcesSnapshot[pathsKey] = [
            ...(this.cachedSourcesSnapshot[pathsKey] || []),
            deepClone(data),
          ];
        }
      }
    }
    return this.cachedSourcesSnapshot[pathsKey];
  }

  private cachedAllSchemasSnapshot: Record<
    ModuleFilePath,
    SerializedSchema
  > | null;
  /**
   * Deserialized schemas, used ONLY as the fallback for apps that do not register
   * a client-side ValModules registry. See {@link behaviourSchema}.
   */
  private cachedDeserializedSchemas: Record<
    ModuleFilePath,
    Schema<SelectorSource>
  > | null;

  /**
   * The schema to run BEHAVIOUR against on the main thread — validation,
   * rendering, anything that executes rather than inspects.
   *
   * Prefers the user's own instance, which is the whole point of Phase 7: a
   * `deserializeSchema` copy silently drops the render `select`, the custom
   * validate functions and the router, so behaviour derived from it is a
   * lobotomised approximation. The copy remains the fallback because
   * `<ValModulesClient>` is optional — an app that does not render it has no
   * instances, and a partly-working schema beats none.
   */
  private behaviourSchema(
    moduleFilePath: ModuleFilePath,
    serializedSchema: SerializedSchema,
  ): Schema<SelectorSource> {
    const instance = this.localSchemaInstances?.[moduleFilePath];
    if (instance) {
      return instance;
    }
    if (!this.cachedDeserializedSchemas) {
      this.cachedDeserializedSchemas = {};
    }
    if (!this.cachedDeserializedSchemas[moduleFilePath]) {
      this.cachedDeserializedSchemas[moduleFilePath] =
        deserializeSchema(serializedSchema);
    }
    return this.cachedDeserializedSchemas[moduleFilePath];
  }
  getAllSchemasSnapshot() {
    if (this.cachedAllSchemasSnapshot === null) {
      this.cachedAllSchemasSnapshot = {};
    }
    for (const moduleFilePathS in this.schemas || {}) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      const schema = this.schemas?.[moduleFilePath];
      if (schema) {
        this.cachedAllSchemasSnapshot[moduleFilePath] = deepClone(schema);
      }
    }
    return this.cachedAllSchemasSnapshot;
  }

  private cachedValidationErrors: Record<SourcePath, ValidationError[]> | null;
  getValidationErrorSnapshot(sourcePath: SourcePath) {
    const allValidationErrorsSnapshot = this.getAllValidationErrorsSnapshot();
    return allValidationErrorsSnapshot?.[sourcePath];
  }

  getAllValidationErrorsSnapshot() {
    if (!this.cachedValidationErrors) {
      const raw: Record<SourcePath, ValidationError[]> = {};
      const validationErrors = this.errors.validationErrors || {};
      for (const sourcePathS in validationErrors) {
        const sourcePath = sourcePathS as SourcePath;
        const newErrors: ValidationError[] = [];
        for (const error of validationErrors[sourcePath] || []) {
          if (error) {
            newErrors.push(error);
          }
        }
        if (newErrors.length > 0) {
          raw[sourcePath] = newErrors;
        }
      }
      // Resolve keyof:check-keys / router:check-route against the current
      // schema/source snapshot so no UI consumer sees the raw "version
      // mismatch" message emitted by core schemas.
      const resolved = resolveSchemaSourceFixes(raw, {
        schemas: this.getAllSchemasSnapshot(),
        sources: this.getAllSourcesSnapshot(),
      });
      // Drop fixes the server resolves on save (image/file metadata, remote
      // files, gallery directory checks). We partition (not filter) so a
      // future "N fixes pending" indicator can opt into the `skipped` half
      // without re-deriving it. See partitionValidationErrors for the policy.
      const { surfaced } = partitionValidationErrors(resolved);
      this.cachedValidationErrors = surfaced;
    }
    return this.cachedValidationErrors;
  }

  private cachedSyncStatus: Record<SourcePath, SyncStatus | null> | null;
  getSyncStatusSnapshot(sourcePath: SourcePath) {
    if (this.cachedSyncStatus === null) {
      this.cachedSyncStatus = {};
    }
    if (this.cachedSyncStatus[sourcePath] === undefined) {
      this.cachedSyncStatus[sourcePath] = this.syncStatus[sourcePath] || null;
    }
    return this.cachedSyncStatus[sourcePath];
  }

  private cachedPendingOpsCountSnapshot: number | null;
  getPendingOpsSnapshot() {
    if (this.cachedPendingOpsCountSnapshot === null) {
      this.cachedPendingOpsCountSnapshot = this.pendingOps.length;
    }
    return this.cachedPendingOpsCountSnapshot;
  }

  private cachedSerializedPatchSetsSnapshot: SerializedPatchSet | null;
  getSerializedPatchSetsSnapshot() {
    if (!this.cachedSerializedPatchSetsSnapshot) {
      this.cachedSerializedPatchSetsSnapshot = this.patchSets.serialize();
    }
    return this.cachedSerializedPatchSetsSnapshot;
  }

  /**
   * Increments on every successful publish. See {@link publishCount}.
   */
  getPublishCountSnapshot() {
    return this.publishCount;
  }

  private cachedInitializedAtSnapshot: { data: number | null } | null;
  getInitializedAtSnapshot() {
    if (this.cachedInitializedAtSnapshot === null) {
      this.cachedInitializedAtSnapshot = {
        data: this.initializedAt,
      };
    }
    return this.cachedInitializedAtSnapshot;
  }

  private cachedPatchErrorsSnapshot: Record<
    string,
    Record<ModuleFilePath, Record<PatchId, PatchErrorEntry> | null>
  > | null;
  getPatchErrorsSnapshot(
    moduleFilePaths: ModuleFilePath[],
  ):
    | Record<ModuleFilePath, Record<PatchId, PatchErrorEntry> | null>
    | undefined {
    const pathsKey = moduleFilePaths.sort().join("|");
    // TODO: not quite sure this works well, however it is only used in one place and seems to work there - something to revise!
    if (this.cachedPatchErrorsSnapshot === null) {
      this.cachedPatchErrorsSnapshot = {};
      const result: Record<
        ModuleFilePath,
        Record<PatchId, PatchErrorEntry> | null
      > = {};
      let hasErrors = false;
      for (const moduleFilePath of moduleFilePaths) {
        if (this.errors.patchErrors?.[moduleFilePath]) {
          result[moduleFilePath] = {
            ...(result[moduleFilePath] || {}),
            ...deepClone(this.errors.patchErrors[moduleFilePath]!),
          };
          hasErrors = true;
        }
      }
      if (hasErrors) {
        this.cachedPatchErrorsSnapshot[pathsKey] = result;
      }
    }
    return this.cachedPatchErrorsSnapshot[pathsKey];
  }

  private cachedPatchData: Record<
    PatchId,
    {
      moduleFilePath: ModuleFilePath;
      patch: Patch;
      isPending: boolean;
      createdAt: string;
      authorId: string | null;
      isCommitted?: {
        commitSha: string;
      };
    }
  > | null;
  getAllPatchesSnapshot() {
    if (!this.cachedPatchData) {
      this.cachedPatchData = {};
      for (const patchIdS in this.patchDataByPatchId) {
        const patchId = patchIdS as PatchId;
        const patchData = this.patchDataByPatchId[patchId];
        if (patchData) {
          this.cachedPatchData[patchId] = deepClone(patchData);
        }
      }
    }
    return this.cachedPatchData;
  }

  private cachedGlobalServerSidePatchIdsSnapshot: PatchId[] | null;
  getGlobalServerSidePatchIdsSnapshot() {
    if (this.cachedGlobalServerSidePatchIdsSnapshot === null) {
      this.cachedGlobalServerSidePatchIdsSnapshot =
        this.globalServerSidePatchIds?.slice() || [];
    }
    return this.cachedGlobalServerSidePatchIdsSnapshot;
  }

  private cachedPendingClientSidePatchIdsSnapshot: PatchId[] | null;
  getPendingClientSidePatchIdsSnapshot() {
    if (this.cachedPendingClientSidePatchIdsSnapshot === null) {
      this.cachedPendingClientSidePatchIdsSnapshot =
        this.pendingClientPatchIds?.slice() || [];
    }
    return this.cachedPendingClientSidePatchIdsSnapshot;
  }

  private cachedSyncedServerSidePatchIdsSnapshot: PatchId[] | null;
  getSyncedServerSidePatchIdsSnapshot() {
    if (this.cachedSyncedServerSidePatchIdsSnapshot === null) {
      this.cachedSyncedServerSidePatchIdsSnapshot =
        this.syncedServerSidePatchIds?.slice() || [];
    }
    return this.cachedSyncedServerSidePatchIdsSnapshot;
  }

  private cachedSavedServerSidePatchIdsSnapshot: PatchId[] | null;
  getSavedServerSidePatchIdsSnapshot() {
    if (this.cachedSavedServerSidePatchIdsSnapshot === null) {
      this.cachedSavedServerSidePatchIdsSnapshot =
        this.savedButNotYetGlobalServerSidePatchIds?.slice() || [];
    }
    return this.cachedSavedServerSidePatchIdsSnapshot;
  }

  private cachedPublishDisabledSnapshot: boolean | null;
  getPublishDisabledSnapshot() {
    if (this.cachedPublishDisabledSnapshot === null) {
      this.cachedPublishDisabledSnapshot = this.publishDisabled;
    }
    return this.cachedPublishDisabledSnapshot;
  }

  private cachedSchemaOutOfDateSnapshot: boolean | null;
  getSchemaOutOfDateSnapshot() {
    if (this.cachedSchemaOutOfDateSnapshot === null) {
      this.cachedSchemaOutOfDateSnapshot = this.schemaOutOfDate;
    }
    return this.cachedSchemaOutOfDateSnapshot;
  }

  private cachedLocalModulesStatusSnapshot: LocalModulesStatus | null;
  getLocalModulesStatusSnapshot(): LocalModulesStatus {
    if (this.cachedLocalModulesStatusSnapshot === null) {
      this.cachedLocalModulesStatusSnapshot = this.localModulesStatus;
    }
    return this.cachedLocalModulesStatusSnapshot;
  }

  private cachedAutoPublishSnapshot: boolean | null;
  getAutoPublishSnapshot() {
    if (this.cachedAutoPublishSnapshot === null) {
      this.cachedAutoPublishSnapshot = this.autoPublish;
    }
    return this.cachedAutoPublishSnapshot;
  }

  private cachedGlobalTransientErrorSnapshot:
    | {
        message: string;
        timestamp: number;
        details?: string;
        id: string;
      }[]
    | null;
  getGlobalTransientErrorsSnapshot() {
    if (this.cachedGlobalTransientErrorSnapshot === null) {
      this.cachedGlobalTransientErrorSnapshot =
        this.errors.globalTransientErrorQueue?.slice() || [];
    }
    return this.cachedGlobalTransientErrorSnapshot;
  }

  private cachedNetworkErrorSnapshot: number | null | undefined;
  getNetworkErrorSnapshot() {
    if (this.cachedNetworkErrorSnapshot === undefined) {
      this.cachedNetworkErrorSnapshot =
        this.errors.hasNetworkErrorTimestamp || null;
    }
    return this.cachedNetworkErrorSnapshot;
  }

  private cachedSchemaErrorSnapshot: number | null | undefined;
  getSchemaErrorSnapshot() {
    if (this.cachedSchemaErrorSnapshot === undefined) {
      this.cachedSchemaErrorSnapshot =
        this.errors.hasSchemaErrorTimestamp || null;
    }
    return this.cachedSchemaErrorSnapshot;
  }

  private cachedParentRef: ParentRef | null | undefined;
  getParentRefSnapshot() {
    if (this.cachedParentRef === undefined) {
      this.cachedParentRef = this.getParentRef();
    }
    return this.cachedParentRef;
  }

  // #region Patching
  /**
   * Dry-runs a patch against the current patched view to confirm it applies
   * cleanly. No state mutation: the caller registers the patch in
   * `patchDataByPatchId` + `pendingClientPatchIds` + `patchIdsByModuleFilePath`
   * and lets `getPatchedSource` fold it into the view on the next read.
   */
  private addPatchOnClientOnly(
    sourcePath: SourcePath | ModuleFilePath,
    patch: Patch,
    now: number,
  ):
    | {
        status: "patch-applies";
        moduleFilePath: ModuleFilePath;
        patch: Patch;
      }
    | {
        status: "patch-error";
        message: string;
        moduleFilePath: ModuleFilePath;
      } {
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
      sourcePath as SourcePath,
    );
    if (
      this.serverSources === null ||
      this.serverSources?.[moduleFilePath] === undefined
    ) {
      // This happens if the client adds patches but server sources have not
      // yet been initialized — should not happen in practice.
      this.addGlobalTransientError(
        `Content at '${moduleFilePath}' is not yet initialized`,
        now,
      );
      return {
        status: "patch-error",
        message: `Content at '${moduleFilePath}' is not yet initialized`,
        moduleFilePath,
      };
    }
    const currentPatched = this.getPatchedSource(moduleFilePath);
    if (currentPatched === undefined) {
      return {
        status: "patch-error",
        message: `Content at '${moduleFilePath}' is not yet initialized`,
        moduleFilePath,
      };
    }
    const patchableOps = patch.filter((op) => op.op !== "file");
    if (patchableOps.length === 0) {
      // File-only patch — nothing to apply against the source value.
      return { status: "patch-applies", moduleFilePath, patch } as const;
    }
    const patchRes = applyPatch(deepClone(currentPatched), ops, patchableOps);
    if (result.isErr(patchRes)) {
      console.error("Could not apply patch:", patchRes.error);
      this.addGlobalTransientError(
        `Could not apply patch: ${patchRes.error.message}`,
        now,
      );
      return {
        status: "patch-error",
        message: patchRes.error.message,
        moduleFilePath,
      };
    }
    return { status: "patch-applies", moduleFilePath, patch } as const;
  }

  private ensureValidationWorker(): ValidationWorkerClient {
    if (!this.validationWorker) {
      this.validationWorker = new ValidationWorkerClient(
        (moduleFilePath, result) => {
          this.applyValidationResult(moduleFilePath, result.errors);
          if (result.customValidate) {
            void this.runCustomValidation(
              moduleFilePath,
              result.customValidate,
            );
          }
        },
        this.createValidationWorker,
      );
    }
    return this.validationWorker;
  }

  /**
   * @param custom Also run the module's custom validate functions. Deliberately
   * opt-in per call: custom validation is triggered by UPDATES (and pre-publish),
   * never by the load path, so booting or HMR-ing a project does not execute
   * arbitrary user code for every module.
   */
  private requestModuleValidation(
    moduleFilePath: ModuleFilePath,
    options?: { custom?: boolean },
  ): void {
    // Validate against whatever schema is currently loaded, regardless of
    // whether it came from local `ValModules` or the server's `/schema`.
    // `/sources/~` is always called with `validate_sources=false`, so this
    // client-side worker validation is the only validation that runs.
    const schemaSha = this.clientSideSchemaSha;
    if (!schemaSha) return;
    const serializedSchema = this.schemas?.[moduleFilePath];
    if (!serializedSchema) return;
    const source = this.getPatchedSource(moduleFilePath);
    if (source === undefined) return;
    // Every structural pass replaces the module's whole error slice, so any custom
    // run still in flight is now working from a superseded source: bump the
    // generation and its results will be dropped.
    this.customValidationGeneration.set(
      moduleFilePath,
      (this.customValidationGeneration.get(moduleFilePath) ?? 0) + 1,
    );
    this.ensureValidationWorker().validate(
      moduleFilePath,
      source as Source,
      serializedSchema,
      schemaSha,
      options?.custom === true &&
        this.moduleHasCustomValidate(moduleFilePath, serializedSchema),
    );
  }

  private requestAllModuleValidation(): void {
    const schemas = this.schemas;
    if (!schemas) return;
    for (const moduleFilePath of Object.keys(schemas) as ModuleFilePath[]) {
      // Structural only: this fires on boot and on every HMR.
      this.requestModuleValidation(moduleFilePath);
    }
  }

  // #region Custom validation (client-side, main thread)
  /**
   * Bumped on every structural validation request. A custom run captures the
   * value it started with and throws its results away if it no longer matches —
   * publishing errors computed from a source that has since moved is how a
   * validation store starts lying.
   */
  private customValidationGeneration: Map<ModuleFilePath, number> = new Map();
  /**
   * The `needs-keys` set the last custom-validation attempt asked for, per
   * module. If an attempt asks for the same set twice, the load did not help
   * (entries failed), and continuing would spin.
   */
  private lastCustomValidateNeedsKeys: Map<ModuleFilePath, string> = new Map();
  /** Memoized answer to "does this module declare any custom validator?" */
  private customValidateGate: {
    schemaSha: string;
    byModule: Map<ModuleFilePath, boolean>;
  } | null = null;

  /**
   * Whether the module declares any custom validate function, from the SERIALIZED
   * schema (which carries a `customValidate: true` flag per node).
   *
   * This is the gate for the entire feature: in the common case no module
   * declares one, so nothing extra is walked in the worker, nothing is posted
   * back and nothing runs on the main thread.
   */
  private moduleHasCustomValidate(
    moduleFilePath: ModuleFilePath,
    serializedSchema: SerializedSchema,
  ): boolean {
    const schemaSha = this.clientSideSchemaSha;
    if (schemaSha === null) {
      return false;
    }
    if (this.customValidateGate?.schemaSha !== schemaSha) {
      this.customValidateGate = { schemaSha, byModule: new Map() };
    }
    const cached = this.customValidateGate.byModule.get(moduleFilePath);
    if (cached !== undefined) {
      return cached;
    }
    const computed = hasCustomValidate(serializedSchema);
    this.customValidateGate.byModule.set(moduleFilePath, computed);
    return computed;
  }

  /**
   * Runs the custom validators the worker located, loading `.jsonValues()` entry
   * content first if any of them would otherwise see an opaque marker.
   */
  private async runCustomValidation(
    moduleFilePath: ModuleFilePath,
    targets: { paths: SourcePath[]; needsJsonKeys: string[] },
  ): Promise<void> {
    const generation = this.customValidationGeneration.get(moduleFilePath) ?? 0;
    if (targets.needsJsonKeys.length > 0) {
      const signature = [...targets.needsJsonKeys].sort().join("\0");
      if (this.lastCustomValidateNeedsKeys.get(moduleFilePath) === signature) {
        // We already loaded (or tried to load) exactly this set and the walk still
        // wants it, which means the load failed. Skipping is the honest outcome:
        // running a validator against markers would invent errors, and claiming
        // the module is clean would hide real ones. The server validates every
        // entry on publish regardless.
        console.error(
          "Val: skipping custom validation — could not load the json entries it needs",
          { moduleFilePath, keys: targets.needsJsonKeys },
        );
        this.lastCustomValidateNeedsKeys.delete(moduleFilePath);
        return;
      }
      this.lastCustomValidateNeedsKeys.set(moduleFilePath, signature);
      await this.ensureJsonEntries([moduleFilePath]);
      if (
        (this.customValidationGeneration.get(moduleFilePath) ?? 0) !==
        generation
      ) {
        return; // superseded while loading
      }
      // The source changed, so the WALK has to be redone (a loaded entry may hold
      // more flagged nodes). This bumps the generation, so the current run ends
      // here.
      this.requestModuleValidation(moduleFilePath, { custom: true });
      return;
    }
    this.lastCustomValidateNeedsKeys.delete(moduleFilePath);
    await this.executeCustomValidations(
      moduleFilePath,
      generation,
      targets.paths,
    );
  }

  /**
   * Executes each flagged node's validators, yielding to the browser every
   * {@link CUSTOM_VALIDATION_SLICE_MS} so a module with many of them cannot block
   * interaction. Results are merged as they are produced, so the first errors show
   * up before the last node has run.
   */
  private async executeCustomValidations(
    moduleFilePath: ModuleFilePath,
    generation: number,
    paths: SourcePath[],
  ): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    const instance = this.localSchemaInstances?.[moduleFilePath];
    if (!instance) {
      // No instances (the host app does not render <ValModulesClient>): custom
      // validation is not possible client-side at all. Documented, not silent.
      console.warn(
        "Val: cannot run custom validation without local val modules",
        moduleFilePath,
      );
      return;
    }
    const source = this.getPatchedSource(moduleFilePath);
    if (source === undefined) {
      return;
    }
    const errors: Record<SourcePath, ValidationError[]> = {};
    let sliceDeadline = Date.now() + CUSTOM_VALIDATION_SLICE_MS;
    for (const path of paths) {
      if (
        (this.customValidationGeneration.get(moduleFilePath) ?? 0) !==
        generation
      ) {
        return;
      }
      const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
      try {
        const resolved = Internal.resolvePath(
          modulePath,
          source as Source,
          instance,
        );
        const nodeErrors = resolved.schema["executeCustomValidateAt"](
          path,
          resolved.source as SelectorSource,
        );
        if (nodeErrors.length > 0) {
          errors[path] = nodeErrors;
        }
      } catch (e) {
        // A path the walk reported but we cannot resolve is a bug in the walk, not
        // a content error: log it and keep going rather than losing the rest.
        console.error("Val: could not run custom validation at", path, e);
      }
      if (Date.now() > sliceDeadline) {
        this.mergeCustomValidationErrors(moduleFilePath, generation, errors);
        await this.yieldToBackground();
        sliceDeadline = Date.now() + CUSTOM_VALIDATION_SLICE_MS;
      }
    }
    this.mergeCustomValidationErrors(moduleFilePath, generation, errors);
  }

  /**
   * Merges custom errors into the module's slice.
   *
   * MERGE, not replace: the structural result was published first (fast feedback)
   * and a wholesale replace would erase it. Stale generations are dropped.
   */
  private mergeCustomValidationErrors(
    moduleFilePath: ModuleFilePath,
    generation: number,
    errors: Record<SourcePath, ValidationError[]>,
  ): void {
    if (
      (this.customValidationGeneration.get(moduleFilePath) ?? 0) !== generation
    ) {
      return;
    }
    const paths = Object.keys(errors) as SourcePath[];
    if (paths.length === 0) {
      return;
    }
    if (!this.errors.validationErrors) {
      this.errors.validationErrors = {};
    }
    for (const path of paths) {
      const existing = this.errors.validationErrors[path];
      const merged = existing ? [...existing] : [];
      for (const error of errors[path]) {
        // The same custom error can arrive twice: a later slice re-merges the
        // accumulated map. Dedupe on the message so the UI does not repeat it.
        if (!merged.some((prev) => prev.message === error.message)) {
          merged.push(error);
        }
      }
      this.errors.validationErrors[path] = merged;
      this.invalidateValidationError(path);
    }
    this.invalidateAllValidationErrors();
  }

  /**
   * Runs a module's custom validators start to finish, resolving when they have
   * all executed (or when it is established that they cannot).
   *
   * The awaitable variant of {@link runCustomValidation}: the worker-driven path
   * is fire-and-forget, which is right for typing but not for the two callers that
   * must not proceed until the answer is in — the pre-publish pass and
   * {@link validateAll}. The (schema, source) walk runs on the main thread here;
   * it is cheap next to the validators themselves.
   */
  private async runCustomValidationNow(
    moduleFilePath: ModuleFilePath,
  ): Promise<void> {
    const serializedSchema = this.schemas?.[moduleFilePath];
    if (!serializedSchema) {
      return;
    }
    if (!this.moduleHasCustomValidate(moduleFilePath, serializedSchema)) {
      return; // the common case: nothing to do, nothing paid
    }
    const source = this.getPatchedSource(moduleFilePath);
    if (source === undefined) {
      return;
    }
    let targets = collectCustomValidateTargets(
      moduleFilePath,
      serializedSchema,
      source as Source,
    );
    if (targets.needsJsonKeys.length > 0) {
      await this.ensureJsonEntries([moduleFilePath]);
      const loadedSource = this.getPatchedSource(moduleFilePath);
      if (loadedSource === undefined) {
        return;
      }
      targets = collectCustomValidateTargets(
        moduleFilePath,
        serializedSchema,
        loadedSource as Source,
      );
      if (targets.needsJsonKeys.length > 0) {
        // Same reasoning as in runCustomValidation: an entry that will not load
        // makes this pass incomplete, and inventing errors from markers (or
        // reporting "clean") would both be lies. The server validates every entry
        // on publish, so publishing is still gated by something.
        console.error(
          "Val: skipping custom validation — could not load the json entries it needs",
          { moduleFilePath, keys: targets.needsJsonKeys },
        );
        return;
      }
    }
    await this.executeCustomValidations(
      moduleFilePath,
      this.customValidationGeneration.get(moduleFilePath) ?? 0,
      targets.paths,
    );
  }

  /**
   * Validates everything, on demand: for dev, CI and debugging.
   *
   * `custom` also executes user validate functions; `loadAllJsonEntries` loads
   * every `.jsonValues()` entry first (reported through the json-entries progress
   * store) so nothing is skipped for being un-loaded. Neither happens on any
   * normal code path — that is the point of having a switch.
   */
  async validateAll(options?: {
    custom?: boolean;
    loadAllJsonEntries?: boolean;
  }): Promise<void> {
    const schemas = this.schemas;
    if (!schemas) {
      return;
    }
    const moduleFilePaths = Object.keys(schemas) as ModuleFilePath[];
    if (options?.loadAllJsonEntries) {
      await this.ensureJsonEntries(moduleFilePaths);
    }
    for (const moduleFilePath of moduleFilePaths) {
      this.requestModuleValidation(moduleFilePath);
    }
    if (options?.custom) {
      for (const moduleFilePath of moduleFilePaths) {
        await this.runCustomValidationNow(moduleFilePath);
      }
    }
  }

  /**
   * Runs custom validation for every module the given patches touch, and resolves
   * once it has finished. Called before publish: structural errors are already
   * continuously up to date (every update re-validates), but custom validators
   * only run on update of THEIR module, so a module edited before a validator was
   * added — or edited in another session — has never had them run.
   */
  private async runCustomValidationForPatches(
    patchIds: PatchId[],
  ): Promise<void> {
    const moduleFilePaths = new Set<ModuleFilePath>();
    for (const patchId of patchIds) {
      const moduleFilePath = this.patchDataByPatchId[patchId]?.moduleFilePath;
      if (moduleFilePath !== undefined) {
        moduleFilePaths.add(moduleFilePath);
      }
    }
    for (const moduleFilePath of moduleFilePaths) {
      await this.runCustomValidationNow(moduleFilePath);
    }
  }

  /** Overridable in tests, where yielding to a real scheduler is not wanted. */
  protected yieldToBackground(): Promise<void> {
    return yieldToBackground();
  }
  // #endregion Custom validation

  private applyValidationResult(
    moduleFilePath: ModuleFilePath,
    errors: ValidationErrors,
  ): void {
    if (!this.errors.validationErrors) {
      this.errors.validationErrors = {};
    }
    const changed = new Set<SourcePath>();
    // Drop any previous entries that belong to this module — schema validation
    // returns the full set of errors for the module on each call, so anything
    // not present in `errors` should be cleared.
    for (const sourcePathS in this.errors.validationErrors) {
      const sourcePath = sourcePathS as SourcePath;
      if (
        (sourcePath as string) === (moduleFilePath as string) ||
        sourcePath.startsWith(moduleFilePath + ".") ||
        sourcePath.startsWith(moduleFilePath + "?")
      ) {
        if (this.errors.validationErrors[sourcePath] !== undefined) {
          this.errors.validationErrors[sourcePath] = undefined;
          changed.add(sourcePath);
        }
      }
    }
    if (errors !== false) {
      for (const sourcePathS in errors) {
        const sourcePath = sourcePathS as SourcePath;
        this.errors.validationErrors[sourcePath] = errors[sourcePath];
        changed.add(sourcePath);
      }
    }
    if (changed.size > 0) {
      this.invalidateAllValidationErrors();
      for (const sourcePath of changed) {
        this.invalidateValidationError(sourcePath);
      }
    }
  }

  validatePatchResult(
    moduleFilePath: ModuleFilePath,
    patch: Patch,
  ):
    | ValidationErrors
    | { status: "no-source" | "no-schema" | "patch-error"; message: string } {
    const currentSource = this.getPatchedSource(moduleFilePath);
    if (currentSource === undefined) {
      return {
        status: "no-source",
        message: `Content at '${moduleFilePath}' is not yet initialized`,
      };
    }
    const serializedSchema = this.schemas?.[moduleFilePath];
    if (!serializedSchema) {
      return {
        status: "no-schema",
        message: `Schema not found for '${moduleFilePath}'`,
      };
    }
    const patchableOps = patch.filter((op) => op.op !== "file");
    const patchRes = applyPatch(
      deepClone(currentSource as JSONValue),
      ops,
      patchableOps,
    );
    if (result.isErr(patchRes)) {
      return {
        status: "patch-error",
        message: patchRes.error.message,
      };
    }
    // With the user's instance this also runs their custom validate functions:
    // every schema class's `executeValidate` calls its own, so a patch that only
    // violates a custom rule is now caught here too.
    return this.behaviourSchema(moduleFilePath, serializedSchema)[
      "executeValidate"
    ](moduleFilePath as string as SourcePath, patchRes.value);
  }

  /**
   * Use this to add a patch and IMMEDIATELY sync it to the server.
   * The original intended use case is in conjunction with file operations.
   * We first use this and add / create a new patch, then we can
   * transfer the files to the server directly.
   */
  async addPatchAwaitable(
    sourcePath: SourcePath | ModuleFilePath,
    type: SerializedSchema["type"],
    patch: Patch,
    patchId: PatchId,
    sessionId: string | null,
    now: number,
    creatorId?: string,
    parentRefOverride?: ParentRef,
  ): Promise<
    | {
        status: "patch-synced";
        patchId: PatchId;
        parentRef: ParentRef; // this is the parent ref of the patch we just added (so before it was added) - we use it to upload files
        moduleFilePath: ModuleFilePath;
      }
    | {
        status: "patch-sync-error";
        message: string;
        moduleFilePath: ModuleFilePath;
      }
    | {
        status: "patch-error";
        message: string;
        moduleFilePath: ModuleFilePath;
      }
  > {
    const res = this.addPatchOnClientOnly(sourcePath, patch, now);
    if (res.status !== "patch-applies") {
      return res;
    }

    const { moduleFilePath, patch: addedPatch } = res;
    // Register the patch so getPatchedSource folds it into the view
    // immediately. On sync failure, executeAddPatches removes it from
    // patchIdsByModule + patchDataByPatchId + pendingClientPatchIds.
    this.patchDataByPatchId[patchId] = {
      moduleFilePath,
      patch: addedPatch,
      isPending: true,
      createdAt: new Date(now).toISOString(),
      authorId: this.authorId,
    };
    this.pendingClientPatchIds.push(patchId);
    this.addToPatchIdsByModule(moduleFilePath, patchId);
    if (creatorId) {
      this.addToCreatorId(creatorId, patchId);
    }
    this.invalidateAllPatches();
    this.invalidatePendingClientSidePatchIds();
    this.invalidateSource(moduleFilePath);
    this.requestModuleValidation(moduleFilePath, { custom: true });
    const addOp: AddPatchOp = {
      type: "add-patches",
      data: {
        [moduleFilePath]: [
          {
            patch: addedPatch,
            patchId,
            type,
          },
        ],
      },
      createdAt: now,
    };
    let tries = 0;
    this.syncStatus[sourcePath] = "patches-pending";
    this.invalidateSyncStatus(sourcePath);
    let opRes = await this.executeAddPatches(addOp, {}, now, parentRefOverride);
    while (opRes.status === "retry" && tries < 3) {
      tries++;
      await new Promise((resolve) => setTimeout(resolve, 500 * (tries + 1))); // wait 500ms, 1000ms, 1500ms
      opRes = await this.executeAddPatches(addOp, {}, now, parentRefOverride);
      if (opRes.status !== "retry") {
        break;
      }
    }
    this.syncStatus[sourcePath] = "done";
    this.invalidateSyncStatus(sourcePath);
    if (opRes.status === "done") {
      return {
        status: "patch-synced",
        patchId,
        parentRef: opRes.parentRef,
        moduleFilePath,
      } as const;
    }
    // Cleanup happened in executeAddPatches's failure path; just invalidate.
    this.invalidateSource(moduleFilePath);
    this.requestModuleValidation(moduleFilePath, { custom: true });
    return {
      status: "patch-sync-error",
      message: "Could not sync patch. Tried 3 times.",
      moduleFilePath,
    } as const;
  }

  addPatch(
    sourcePath: SourcePath | ModuleFilePath,
    type: SerializedSchema["type"],
    patch: Patch,
    now: number,
    creatorId?: string,
  ):
    | {
        status: "patch-merged";
        patchId: PatchId;
        moduleFilePath: ModuleFilePath;
      }
    | {
        status: "patch-added";
        patchId: PatchId;
        moduleFilePath: ModuleFilePath;
      }
    | {
        status: "patch-error";
        message: string;
        moduleFilePath: ModuleFilePath;
      } {
    const res = this.addPatchOnClientOnly(sourcePath, patch, now);
    if (res.status !== "patch-applies") {
      return res;
    }
    const moduleFilePath = res.moduleFilePath;
    this.syncStatus[sourcePath] = "patches-pending";
    this.invalidateSyncStatus(sourcePath);
    const lastOp = this.pendingOps[this.pendingOps.length - 1];
    // Try to batch add-patches ops together to avoid too many requests...
    if (lastOp?.type === "add-patches") {
      // ... either by merging them if possible (reduces amount of patch ops and data)
      const lastPatchIdx = (lastOp.data?.[moduleFilePath]?.length || 0) - 1;
      const lastPatch = lastOp.data?.[moduleFilePath]?.[lastPatchIdx]?.patch;
      const lastPatchId =
        lastOp.data?.[moduleFilePath]?.[lastPatchIdx]?.patchId;
      if (
        canMerge(lastPatch, patch) &&
        // The type of the last should always be the same as long as the schema has not changed
        lastOp.data?.[moduleFilePath]?.[lastPatchIdx]?.type === type &&
        // If we do not have patchId nor patchData something is wrong and in this case we simply do not merge the patch
        lastPatchId &&
        this.patchDataByPatchId[lastPatchId]
      ) {
        lastOp.data[moduleFilePath][lastPatchIdx].patch = patch;
        lastOp.updatedAt = now;
        this.invalidatePendingOps();
        this.patchDataByPatchId[lastPatchId]!.patch = patch;
        this.invalidateAllPatches();
        this.patchSetInsert(moduleFilePath, lastPatchId, patch, now);

        this.invalidateSyncStatus(sourcePath);
        this.invalidateSource(moduleFilePath);
        // Optimistically re-validate the edited module so per-field errors
        // (maxLength, regex, ...) surface within a worker round-trip — no
        // waiting for the next sync tick. The worker dedups stale requests
        // when the user keeps typing.
        this.requestModuleValidation(moduleFilePath, { custom: true });

        return {
          status: "patch-merged",
          patchId: lastPatchId,
          moduleFilePath,
        } as const;
      } else {
        // ... or by just pushing it to the last op
        if (!lastOp.data[moduleFilePath]) {
          lastOp.data[moduleFilePath] = [];
        }
        const patchId = this.createPatchId();
        lastOp.data[moduleFilePath].push({
          patch,
          type,
          patchId,
        });
        this.invalidatePendingOps();
        this.pendingClientPatchIds.push(patchId);
        this.invalidatePendingClientSidePatchIds();
        this.patchDataByPatchId[patchId] = {
          moduleFilePath: moduleFilePath,
          patch: patch,
          isPending: true,
          createdAt: new Date(now).toISOString(),
          authorId: this.authorId,
        };
        this.invalidateAllPatches();
        this.addToPatchIdsByModule(moduleFilePath, patchId);
        this.patchSetInsert(moduleFilePath, patchId, patch, now);
        if (creatorId) {
          this.addToCreatorId(creatorId, patchId);
        }

        this.invalidateSyncStatus(sourcePath);
        this.invalidateSource(moduleFilePath);
        this.requestModuleValidation(moduleFilePath, { custom: true });

        return {
          status: "patch-added",
          patchId,
          moduleFilePath,
        } as const;
      }
    } else {
      const patchId = this.createPatchId();
      this.pendingOps.push({
        type: "add-patches",
        data: {
          [moduleFilePath]: [{ patch, type, patchId }],
        },
        createdAt: now,
      });
      this.invalidatePendingOps();
      this.pendingClientPatchIds.push(patchId);
      this.invalidatePendingClientSidePatchIds();
      this.patchDataByPatchId[patchId] = {
        moduleFilePath: moduleFilePath,
        patch: patch,
        isPending: true,
        createdAt: new Date(now).toISOString(),
        authorId: this.authorId,
      };
      this.invalidateAllPatches();
      this.addToPatchIdsByModule(moduleFilePath, patchId);
      this.patchSetInsert(moduleFilePath, patchId, patch, now);
      if (creatorId) {
        this.addToCreatorId(creatorId, patchId);
      }

      this.invalidateSyncStatus(sourcePath);
      this.invalidateSource(moduleFilePath);
      this.requestModuleValidation(moduleFilePath, { custom: true });

      return {
        status: "patch-added",
        patchId,
        moduleFilePath,
      } as const;
    }
  }

  createPatchId() {
    const patchId = crypto.randomUUID() as PatchId;
    return patchId;
  }

  private addToCreatorId(creatorId: string, patchId: PatchId) {
    let arr = this.patchIdsByCreatorId.get(creatorId);
    if (!arr) {
      arr = [];
      this.patchIdsByCreatorId.set(creatorId, arr);
    }
    arr.push(patchId);
  }

  private addToPatchIdsByModule(
    moduleFilePath: ModuleFilePath,
    patchId: PatchId,
  ) {
    let set = this.patchIdsByModuleFilePath.get(moduleFilePath);
    if (!set) {
      set = new Set();
      this.patchIdsByModuleFilePath.set(moduleFilePath, set);
    }
    set.add(patchId);
  }

  private removeFromPatchIdsByModule(patchId: PatchId) {
    const entry = this.patchDataByPatchId[patchId];
    if (entry) {
      const set = this.patchIdsByModuleFilePath.get(entry.moduleFilePath);
      if (set) {
        set.delete(patchId);
      }
    }
  }

  private rebuildPatchIdsByModule() {
    this.patchIdsByModuleFilePath = new Map();
    for (const patchIdS in this.patchDataByPatchId) {
      const patchId = patchIdS as PatchId;
      const entry = this.patchDataByPatchId[patchId];
      if (entry) {
        this.addToPatchIdsByModule(entry.moduleFilePath, patchId);
      }
    }
  }

  private isEditedByComponent(
    moduleFilePath: ModuleFilePath,
    creatorId?: string,
  ): boolean {
    if (!creatorId) return false;
    this.patchIdsByModuleFilePath.get(moduleFilePath);
    const creatorPatchIds = this.patchIdsByCreatorId.get(creatorId);
    if (!creatorPatchIds) {
      return false;
    }

    // check if last patch is created by the creator component:
    const creatorPatchIsTheLastSyncedPatch =
      this.globalServerSidePatchIds &&
      creatorPatchIds[creatorPatchIds.length - 1] ===
        this.globalServerSidePatchIds[this.globalServerSidePatchIds.length - 1];
    const creatorPatchIsTheLastSyncedServerSidePatch =
      this.savedButNotYetGlobalServerSidePatchIds &&
      creatorPatchIds[creatorPatchIds.length - 1] ===
        this.savedButNotYetGlobalServerSidePatchIds[
          this.savedButNotYetGlobalServerSidePatchIds.length - 1
        ];
    const creatorPatchIsTheLastPendingPatch =
      this.pendingClientPatchIds &&
      creatorPatchIds[creatorPatchIds.length - 1] ===
        this.pendingClientPatchIds[this.pendingClientPatchIds.length - 1];
    if (
      creatorPatchIsTheLastSyncedPatch ||
      creatorPatchIsTheLastPendingPatch ||
      creatorPatchIsTheLastSyncedServerSidePatch
    ) {
      return true;
    }
    return false;
  }

  patchSetInsert(
    moduleFilePath: ModuleFilePath,
    patchId: PatchId,
    patch: Patch,
    now: number,
  ) {
    const createdAt = new Date(now).toISOString();
    for (const op of patch) {
      this.patchSets.insert(
        moduleFilePath,
        this.schemas?.[moduleFilePath] ?? undefined,
        op,
        patchId,
        createdAt,
        this.authorId,
      );
    }
    this.invalidatePatchSets();
  }

  deletePatches(patchIds: PatchId[], now: number) {
    // Optimistically, like the rest of the delete: removing the offending change
    // is how an editor clears a patch error, so the error has to go now rather
    // than on the next sync. If the delete does not stick, recomputing the
    // module's chain records it again.
    this.forgetPatchErrors(new Set(patchIds));
    const lastOp = this.pendingOps[this.pendingOps.length - 1];
    if (lastOp?.type === "delete-patches") {
      lastOp.patchIds.push(...patchIds);
      lastOp.updatedAt = now;
      return;
    }
    this.pendingOps.push({
      type: "delete-patches",
      patchIds: patchIds,
      createdAt: now,
    });
    this.invalidatePendingOps();
  }

  // #region Misc

  private markAllSyncStatusIn(
    moduleFilePath: ModuleFilePath,
    syncStatus: SyncStatus,
  ) {
    for (const path in this.syncStatus) {
      if (path.startsWith(moduleFilePath)) {
        this.syncStatus[path as SourcePath] = syncStatus;
      }
    }
  }

  getParentRef(): ParentRef | null {
    if (this.baseSha === null) {
      return null;
    }
    if (this.globalServerSidePatchIds === null) {
      return null;
    }
    // NOTE: if we change this function, remember to update to reset the cachedParentRef where appropriate
    const patchId =
      // Avoid conflicts when it is only this client that creates patches
      this.savedButNotYetGlobalServerSidePatchIds[
        this.savedButNotYetGlobalServerSidePatchIds.length - 1
      ] ||
      this.globalServerSidePatchIds[this.globalServerSidePatchIds.length - 1];

    if (!patchId) {
      return {
        type: "head",
        headBaseSha: this.baseSha,
      };
    }
    return {
      type: "patch",
      patchId,
    };
  }

  // #region Stat

  async syncWithUpdatedStat(
    mode: "fs" | "http",
    baseSha: string,
    schemaSha: string,
    sourcesSha: string,
    patchIds: PatchId[],
    authorId: string | null,
    commitSha: string | null,
    now: number,
    /**
     * FS mode only: fingerprint of the `.jsonValues()` entry files on disk. It is
     * the only signal that a hand-edited `*.val.json` changed — `sourcesSha` and
     * `baseSha` hash the module source, which for a jsonValues module is markers
     * with the content behind a thunk `JSON.stringify` drops.
     */
    jsonEntriesSha?: string,
  ): Promise<
    | {
        status: "done";
      }
    | {
        status: "retry";
        reason: RetryReason;
      }
  > {
    const haveLocal = this.localModulesStatus.type === "loaded";
    const sourcesShaDidChange = this.sourcesSha !== sourcesSha;
    // An entry file changed on disk (someone hand-edited a `*.val.json`). The
    // module source is byte-identical either way, so nothing below would notice:
    // mark the loaded entries stale and let the batch loader refetch them.
    // Skipped on the FIRST stat, where there is nothing cached to invalidate.
    if (
      jsonEntriesSha !== undefined &&
      this.jsonEntriesSha !== undefined &&
      this.jsonEntriesSha !== jsonEntriesSha
    ) {
      this.markAllJsonEntriesStale();
    }
    if (jsonEntriesSha !== undefined) {
      this.jsonEntriesSha = jsonEntriesSha;
    }
    this.sourcesSha = sourcesSha;
    this.baseSha = baseSha;
    this.mode = mode;
    // A different (schemaSha, commitSha) than the one we last saw means a new
    // version was deployed while this session was open. On the very first stat
    // there is nothing to compare against yet, so that is not a redeploy.
    const isFirstStat = this.serverSideSchemaSha === null;
    const didRedeploy =
      !isFirstStat &&
      (this.serverSideSchemaSha !== schemaSha || this.commitSha !== commitSha);
    this.serverSideSchemaSha = schemaSha;
    this.commitSha = commitSha;
    // Local schemas are authoritative, so a redeploy under them must NOT
    // reset+init - that would discard local state. The divergence is surfaced
    // by the (http-only) schema-out-of-date dialog instead, and the source sync
    // below keeps running: source updates remain useful while it is open.
    this.recomputeSchemaOutOfDate();
    if (didRedeploy && !haveLocal) {
      // Without local modules the server is the only source of truth, so drop
      // all derived state and re-init against the new deployment. The new SHAs
      // are stashed AFTER reset() (which clears them) so the recursive init's
      // stat-compare doesn't immediately re-trigger this path.
      this.reset();
      this.serverSideSchemaSha = schemaSha;
      this.commitSha = commitSha;
      return this.init(
        mode,
        baseSha,
        schemaSha,
        sourcesSha,
        patchIds,
        authorId,
        commitSha,
        now,
      );
    }
    const previousGlobalServerSidePatchIds = this.globalServerSidePatchIds;
    const patchIdsDidChange =
      this.globalServerSidePatchIds === null ||
      !deepEqual(this.globalServerSidePatchIds, patchIds);
    if (patchIdsDidChange) {
      // Do not update the globalServerSidePatchIds if they are the same
      // since we using this directly in get snapshot method
      this.globalServerSidePatchIds = patchIds;
      const uniquePatchIds = new Set(patchIds);
      this.deletePendingPatchId(uniquePatchIds);
      this.deleteSavedButNotYetGlobalServerSidePatchIds(uniquePatchIds);
      // if (mode === "http") {
      await this.syncPatches(false, now);
      // }
      this.invalidateGlobalServerSidePatchIds();
      this.invalidateSyncedServerSidePatchIds();
      this.invalidateSavedServerSidePatchIds();
      this.invalidatePendingClientSidePatchIds();
    }
    if (!this.forceSyncAllModules && sourcesShaDidChange) {
      this.forceSyncAllModules = true;
    }
    if (patchIdsDidChange && !this.forceSyncAllModules) {
      // A patch-id change on its own never changes what /sources/~ returns:
      // the studio always reads it with apply_patches=false and folds the
      // patch chain in client-side (getPatchedSource). So there is nothing to
      // re-fetch — we only need to re-derive the patched view of the modules
      // whose ordered patch chain actually moved.
      //
      // Forcing a full sync here (as we used to) meant that every keystroke
      // which started a new patch made the server re-evaluate every module and
      // made the client invalidate every module, which is why editing a single
      // field felt slow.
      const affected = this.getModulesAffectedByPatchIdChange(
        previousGlobalServerSidePatchIds,
        patchIds,
      );
      if (affected === "all") {
        this.forceSyncAllModules = true;
      } else {
        for (const moduleFilePath of affected) {
          this.invalidateSource(moduleFilePath);
          this.requestModuleValidation(moduleFilePath);
        }
      }
    }
    return this.sync(now);
  }

  // #region Sync utils
  async executeAddPatches(
    op: AddPatchOp,
    changes: Record<ModuleFilePath, Set<SerializedSchema["type"] | "unknown">>,
    now: number,
    parentRefOverride?: ParentRef,
  ): Promise<
    | {
        status: "done";
        parentRef: ParentRef;
      }
    | {
        status: "retry";
        reason: RetryReason;
      }
  > {
    if (this.schemaOutOfDate) {
      this.addGlobalTransientError(
        "Cannot save: a new version has been deployed. Reload to continue editing.",
        now,
      );
      return {
        status: "retry",
        reason: "schema-out-of-date",
      };
    }
    const postPatchesBody: {
      path: ModuleFilePath;
      patch: Patch;
      patchId: PatchId;
    }[] = [];
    const newPatchIds: PatchId[] = [];
    let didUpdatePatchData = false;
    for (const [path, patchesData] of Object.entries(op.data)) {
      const moduleFilePath = path as ModuleFilePath;
      for (const patchData of patchesData) {
        postPatchesBody.push({
          path: moduleFilePath,
          patchId: patchData.patchId,
          patch: patchData.patch,
        });
        newPatchIds.push(patchData.patchId);
        if (!changes[moduleFilePath]) {
          changes[moduleFilePath] = new Set();
        }
        changes[moduleFilePath].add(patchData.type);
      }
    }
    const parentRef = parentRefOverride ?? this.getParentRef();
    if (parentRef === null) {
      this.addGlobalTransientError(
        `Tried to update content with changes, but could not since Val is not yet initialized`,
        now,
      );
      return {
        status: "retry",
        reason: "not-initialized",
      };
    }
    const addPatchesRes = await this.client("/patches", "PUT", {
      body: {
        patches: postPatchesBody,
        parentRef,
        sessionId: op.sessionId,
      },
    });
    if (addPatchesRes.status !== null) {
      this.resetNetworkError();
    }
    if (
      addPatchesRes.status === null &&
      addPatchesRes.json.type === "network_error"
    ) {
      console.warn("Network error: trying again...");
      this.addNetworkError(now);
      // Try again if it is a network error:
      return {
        status: "retry",
        reason: "network-error",
      };
    } else if (addPatchesRes.status === 409) {
      // Reset saved patch ids since they are not valid anymore
      this.savedButNotYetGlobalServerSidePatchIds = [];
      // Try again if it is a conflict error (NOTE: this can absolutely happen if there are multiple concurrent users)
      return {
        status: "retry",
        reason: "conflict",
      };
    } else if (addPatchesRes.status !== 200) {
      console.error("Failed to add patches", {
        error: addPatchesRes.json.message,
      });
      this.addGlobalTransientError(
        `Failed to save changes`,
        now,
        addPatchesRes.json.message,
      );
      // We failed to add these patches so we must clean up after ourselves
      // NOTE: These patches will be removed, in the future we might want to retry or something
      // Also note that there is (or at least should) be something permanently wrong with these
      // patches so there shouldn't be any need to retry
      for (const patchId of newPatchIds) {
        this.removeFromPatchIdsByModule(patchId as PatchId);
        this.patchDataByPatchId = {
          ...this.patchDataByPatchId,
          [patchId]: undefined,
        };
        didUpdatePatchData = true;
      }
      const newPatchIdsSet = new Set(newPatchIds);
      this.pendingClientPatchIds = this.pendingClientPatchIds.filter(
        (id) => !newPatchIdsSet.has(id),
      );
    } else {
      // Success
      const createdPatchIds = new Set(addPatchesRes.json.newPatchIds);
      this.deletePendingPatchId(createdPatchIds);
      for (const patchIdS of newPatchIds) {
        const patchId = patchIdS as PatchId;
        this.savedButNotYetGlobalServerSidePatchIds.push(patchId);
        if (this.patchDataByPatchId[patchId]) {
          this.patchDataByPatchId[patchId]!.isPending = false;
          didUpdatePatchData = true;
        }
      }
    }
    if (didUpdatePatchData) {
      this.invalidateAllPatches();
    }
    return {
      status: "done",
      parentRef,
    };
  }

  private deletePendingPatchId(patchIds: Set<PatchId>) {
    let deleteCount = 0;
    for (let i = 0; i < this.pendingClientPatchIds.length; i++) {
      const patchId = this.pendingClientPatchIds[i] as PatchId;
      if (patchIds.has(patchId)) {
        this.pendingClientPatchIds.splice(i, 1);
        i--;
        deleteCount++;
        if (patchIds.size === deleteCount) {
          break;
        }
      }
    }
  }

  private deleteSavedButNotYetGlobalServerSidePatchIds(patchIds: Set<PatchId>) {
    let deleteCount = 0;
    for (
      let i = 0;
      i < this.savedButNotYetGlobalServerSidePatchIds.length;
      i++
    ) {
      const patchId = this.savedButNotYetGlobalServerSidePatchIds[i] as PatchId;
      if (patchIds.has(patchId)) {
        this.savedButNotYetGlobalServerSidePatchIds.splice(i, 1);
        i--;
        deleteCount++;
        if (patchIds.size === deleteCount) {
          break;
        }
      }
    }
  }

  async executeDeletePatches(
    op: DeletePatchesOp,
    changes: Record<ModuleFilePath, Set<SerializedSchema["type"] | "unknown">>,
    now: number,
  ): Promise<
    | {
        status: "done";
        syncAllRequired: boolean;
      }
    | {
        status: "retry";
        reason: RetryReason;
      }
  > {
    let syncAllRequired = false;
    const deletePatchIds = op.patchIds;
    const deletePatchIdsSet = new Set(deletePatchIds);
    const deleteRes = await this.client("/patches", "DELETE", {
      query: {
        id: op.patchIds.reverse(),
      },
    });
    if (deleteRes.status !== null) {
      this.resetNetworkError();
    }
    if (deleteRes.status === null && deleteRes.json.type === "network_error") {
      this.addNetworkError(now);
      return {
        status: "retry",
        reason: "network-error",
      };
    } else if (deleteRes.status !== 200) {
      // Give up unless it is a network error
      this.addGlobalTransientError("Failed to delete patches", now);
    } else {
      for (const patchId of op.patchIds) {
        if (this.patchDataByPatchId[patchId]) {
          const currentModuleFilePath =
            this.patchDataByPatchId[patchId]!.moduleFilePath;

          if (!changes[currentModuleFilePath]) {
            changes[currentModuleFilePath] = new Set();
          }
          changes[currentModuleFilePath].add("unknown");
          this.removeFromPatchIdsByModule(patchId);
          this.patchDataByPatchId = {
            ...this.patchDataByPatchId,
            [patchId]: undefined,
          };
        } else {
          syncAllRequired = true;
        }
      }
      this.pendingClientPatchIds = this.pendingClientPatchIds.filter(
        (id) => !deletePatchIdsSet.has(id),
      );
      this.globalServerSidePatchIds =
        this.globalServerSidePatchIds?.filter(
          (id) => !deletePatchIdsSet.has(id),
        ) ?? null;
      this.deleteSavedButNotYetGlobalServerSidePatchIds(deletePatchIdsSet);
      // Removing the offending change is how an editor resolves a patch error,
      // so drop it right away instead of waiting for the next source read to
      // prune it.
      this.forgetPatchErrors(deletePatchIdsSet);
    }
    return {
      status: "done",
      syncAllRequired,
    };
  }

  private forgetPatchErrors(patchIds: Set<PatchId>) {
    if (this.errors.patchErrors === undefined) {
      return;
    }
    for (const [moduleFilePathS, entries] of Object.entries(
      this.errors.patchErrors,
    )) {
      if (!entries) {
        continue;
      }
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      const remaining = Object.fromEntries(
        Object.entries(entries).filter(
          ([patchId]) => !patchIds.has(patchId as PatchId),
        ),
      );
      if (Object.keys(remaining).length === Object.keys(entries).length) {
        continue;
      }
      this.errors.patchErrors[moduleFilePath] =
        Object.keys(remaining).length > 0 ? remaining : null;
      this.invalidatePatchErrors(moduleFilePath);
    }
  }

  async setValModules(valModules: ValModules | null): Promise<void> {
    if (!valModules) {
      this.localSchemas = null;
      this.localSchemaSha = null;
      this.localSchemaInstances = null;
      this.localSources = null;
      this.localSourcesSha = null;
      this.localModulesStatus = { type: "absent" };
      this.invalidateLocalModulesStatus();
      this.recomputeSchemaOutOfDate();
      return;
    }
    const seq = ++this.setValModulesSeq;
    this.localModulesStatus = { type: "loading" };
    this.invalidateLocalModulesStatus();
    let extracted: ExtractedValModules;
    try {
      extracted = await extractValModules(valModules);
    } catch (e) {
      // A newer setValModules call superseded us while we were extracting —
      // drop this stale result so we don't clobber the latest registry state.
      if (seq !== this.setValModulesSeq) return;
      console.debug("setValModules: extractValModules threw", e);
      this.localSchemas = null;
      this.localSchemaSha = null;
      this.localSchemaInstances = null;
      this.localSources = null;
      this.localSourcesSha = null;
      this.localModulesStatus = {
        type: "error",
        moduleErrors: [{ message: e instanceof Error ? e.message : String(e) }],
      };
      this.invalidateLocalModulesStatus();
      this.recomputeSchemaOutOfDate();
      return;
    }
    // Superseded by a newer call while awaiting — ignore this result.
    if (seq !== this.setValModulesSeq) return;
    if (extracted.moduleErrors.length > 0) {
      console.debug(
        "setValModules: moduleErrors present, falling back to server",
        extracted.moduleErrors,
      );
      this.localSchemas = null;
      this.localSchemaSha = null;
      this.localSchemaInstances = null;
      this.localSources = null;
      this.localSourcesSha = null;
      this.localModulesStatus = {
        type: "error",
        moduleErrors: extracted.moduleErrors,
      };
      this.invalidateLocalModulesStatus();
      this.recomputeSchemaOutOfDate();
      return;
    }
    this.localSchemas = extracted.serializedSchemas;
    this.localSchemaSha = extracted.schemaSha;
    // Keep the INSTANCES: this is the only place they are available, and
    // discarding them is what made renders (and custom validators) dead in the
    // Studio — everything downstream re-derived a `deserializeSchema` copy that
    // has neither.
    this.localSchemaInstances = extracted.schemas;
    this.localSources = extracted.sources;
    this.localSourcesSha = extracted.sourcesSha;
    this.localModulesStatus = {
      type: "loaded",
      schemaSha: extracted.schemaSha,
      sourcesSha: extracted.sourcesSha,
      moduleCount: Object.keys(extracted.serializedSchemas).length,
    };
    this.adoptLocalSchemas();
    this.adoptLocalSources();
    // Validate every module with the freshly-adopted local schema so the UI
    // shows existing errors even when the user makes no edits. Also covers
    // HMR — setValModules re-runs and re-validates on every schema change.
    this.requestAllModuleValidation();
    // Make schemas + sources renderable immediately, before /stat arrives.
    // The server-driven init() that follows will still run via the
    // ValProvider init effect, and will reconcile any remote divergence
    // through syncWithUpdatedStat without resetting the local content.
    if (this.initializedAt === null) {
      this.initializedAt = Date.now();
      this.invalidateInitializedAt();
    }
    this.invalidateLocalModulesStatus();
    this.recomputeSchemaOutOfDate();
  }

  private adoptLocalSchemas(): void {
    if (!this.localSchemas || !this.localSchemaSha) return;
    this.schemas = this.localSchemas;
    this.clientSideSchemaSha = this.localSchemaSha;
    this.resetSchemaError();
    this.invalidateSchema();
  }

  private adoptLocalSources(): void {
    if (!this.localSources || !this.localSourcesSha) {
      return;
    }
    // localSources are un-patched, exactly like /sources/~ now returns.
    // Only seed serverSources if we don't already have a server response —
    // overwriting a populated serverSources would race against /sources/~
    // and erase newer disk content. Patches are not seeded here; they layer
    // on in getPatchedSource and Just Work the next time the UI reads.
    const local = this.localSources as Record<ModuleFilePath, JSONValue>;
    if (this.serverSources === null) {
      this.serverSources = { ...local };
      this.sourcesSha = this.localSourcesSha;
    }
    // Make sure the next sync() refetches /sources/~ so any disk edits made
    // outside HMR's reach are picked up (and so an existing serverSources
    // gets refreshed even though we didn't touch it here).
    this.forceSyncAllModules = true;
    this.patchedSourcesCache = null;
    for (const path of Object.keys(local) as ModuleFilePath[]) {
      this.invalidateSource(path);
    }
  }

  private recomputeSchemaOutOfDate() {
    const next =
      this.mode === "http" &&
      this.localSchemaSha !== null &&
      this.serverSideSchemaSha !== null &&
      this.localSchemaSha !== this.serverSideSchemaSha;
    if (next !== this.schemaOutOfDate) {
      this.schemaOutOfDate = next;
      this.invalidateSchemaOutOfDate();
      if (next) {
        this.publishDisabled = true;
        this.invalidatePublishDisabled();
      } else if (!this.isPublishing) {
        // Schema is back in sync (e.g. HMR matched the server, or we fell back
        // to server modules) — re-enable publishing. Don't touch it mid-publish:
        // publish() owns publishDisabled while it runs and clears it in finally.
        this.publishDisabled = false;
        this.invalidatePublishDisabled();
      }
    }
  }

  async syncSchema(): Promise<
    | {
        status: "done";
      }
    | {
        status: "retry";
        reason: "error";
      }
  > {
    if (this.localSchemas && this.localSchemaSha) {
      this.schemas = this.localSchemas;
      this.clientSideSchemaSha = this.localSchemaSha;
      this.resetSchemaError();
      this.invalidateSchema();
      return { status: "done" };
    }

    const schemaRes = await this.client("/schema", "GET", {});
    if (schemaRes.status === 200) {
      this.schemas = {};
      for (const [moduleFilePathS, schema] of Object.entries(
        schemaRes.json.schemas,
      )) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        if (schema) {
          this.schemas[moduleFilePath] = schema;
        }
      }
      const schemaShaDidChange =
        this.clientSideSchemaSha !== schemaRes.json.schemaSha;
      if (schemaShaDidChange) {
        this.clientSideSchemaSha = schemaRes.json.schemaSha;
      }

      console.debug("Invalidating schema");
      this.resetSchemaError();
      this.invalidateSchema();
      if (schemaShaDidChange) {
        // The sources sync only re-validates modules whose source actually
        // changed, so a new schema has to re-validate everything itself.
        this.requestAllModuleValidation();
      }
      return {
        status: "done",
      };
    } else if (schemaRes.status === null) {
      return {
        status: "retry",
        reason: "error",
      };
    }
    // Schema endpoint returned an error (e.g., 500)
    this.addSchemaError(Date.now());
    return {
      status: "retry",
      reason: "error",
    };
  }

  private async syncPatches(
    reset: boolean,
    now: number,
  ): Promise<
    | {
        status: "done";
      }
    | {
        status: "retry";
      }
  > {
    const currentPatchIds = this.globalServerSidePatchIds || [];
    let didUpdatePatchSet = false;
    let didUpdatePatchData = false;

    // get missing data
    if (this.initializedAt === null || reset) {
      this.patchSets = new PatchSets();
      didUpdatePatchSet = true;
      // When we are initializing, we don't want to sync all individual patch sets
      // since we are going to get them all at once anyway
      // Why is this a problem? It's because we can only do about 300 patch ids at a time before the URL gets too long
      // Now, you might be saying that is an API issue, and you might be right (but this way we at least can cache the patch ids heavily)
      const res = await this.client("/patches", "GET", {
        query: {
          exclude_patch_ops: false,
          patch_id: undefined, // all patches
        },
      });
      if (res.status !== 200) {
        console.debug("Val: SyncEngine: Failed to get changes (full sync)", {
          res,
        });
        return {
          status: "retry",
        };
      }
      for (const patchData of res.json.patches) {
        if (patchData.patch) {
          didUpdatePatchData = true;
          this.patchDataByPatchId[patchData.patchId] = {
            moduleFilePath: patchData.path,
            patch: patchData.patch,
            isPending: false,
            createdAt: patchData.createdAt,
            authorId: patchData.authorId,
            isCommitted: patchData.appliedAt
              ? {
                  commitSha: patchData.appliedAt.commitSha,
                }
              : undefined,
          };
          this.addToPatchIdsByModule(patchData.path, patchData.patchId);
        }
      }
      if (res.json.error) {
        this.addGlobalTransientError(
          "Some changes has errors",
          now,
          res.json.error.message,
        );
      }
      for (const error of Object.values(res.json.errors || {})) {
        if (error) {
          this.addGlobalTransientError(
            "A change has an error",
            now,
            error.message,
          );
        }
      }
    } else {
      // Get missing patch data for potentially new global server side patch ids
      const missingPatchData: PatchId[] = [];
      for (const serverSidePatchId of this.globalServerSidePatchIds || []) {
        if (!this.patchDataByPatchId[serverSidePatchId]) {
          missingPatchData.push(serverSidePatchId);
        }
      }
      if (missingPatchData.length > 0) {
        // Batch in batches of 100 to avoid URL length issues
        const batchSize = 100;
        const batches = [];
        for (let i = 0; i < missingPatchData.length; i += batchSize) {
          batches.push(missingPatchData.slice(i, i + batchSize));
        }
        for (const batch of batches) {
          const res = await this.client("/patches", "GET", {
            query: {
              exclude_patch_ops: false,
              patch_id: batch,
            },
          });
          if (res.status !== 200) {
            console.debug(
              "Val: SyncEngine: Failed to get changes (batch) - null status",
              {
                res,
              },
            );
            return {
              status: "retry",
            };
          }
          for (const patchData of res.json.patches) {
            if (patchData.patch) {
              didUpdatePatchData = true;
              this.patchDataByPatchId[patchData.patchId] = {
                moduleFilePath: patchData.path,
                patch: patchData.patch,
                isPending: false,
                createdAt: patchData.createdAt,
                authorId: patchData.authorId,
                isCommitted: patchData.appliedAt
                  ? {
                      commitSha: patchData.appliedAt.commitSha,
                    }
                  : undefined,
              };
              this.addToPatchIdsByModule(patchData.path, patchData.patchId);
            }
          }
        }
      }
    }

    const allCurrentPatchIds = new Set(currentPatchIds);
    for (const patchId of Array.from(this.patchSets.getInsertedPatches()) ||
      []) {
      if (!allCurrentPatchIds.has(patchId)) {
        // The patch set is dirty, so we need to reset it
        // Maybe we should add a remove method on PatchSets?
        this.patchSets = new PatchSets();
        didUpdatePatchSet = true;
        break;
      }
    }

    // All patch ids should be good, but we might have had new patches added while we were syncing data
    // In that case, we will retry
    const missingDataPatchIds = [];
    for (const patchId of currentPatchIds) {
      if (!this.patchSets.isInserted(patchId)) {
        const patchData = this.patchDataByPatchId[patchId];
        const schema =
          patchData?.moduleFilePath &&
          this.schemas?.[patchData?.moduleFilePath];
        if (patchData && schema) {
          for (const op of patchData.patch) {
            didUpdatePatchSet = true;
            this.patchSets.insert(
              patchData.moduleFilePath,
              schema,
              op,
              patchId,
              patchData.createdAt,
              patchData.authorId,
            );
          }
        } else {
          missingDataPatchIds.push(patchId);
        }
      }
    }
    if (didUpdatePatchData) {
      this.invalidateAllPatches();
    }
    if (didUpdatePatchSet) {
      this.invalidatePatchSets();
    }
    if (missingDataPatchIds.length > 0) {
      if (this.initializedAt !== null) {
        console.debug("Missing data for patch ids", missingDataPatchIds, {
          currentPatchIds,
          reset,
        });
        // TODO: we disabled this error on fs since in auto save it comes every time it saves.
        // We should figure out why that happens and re-enable the error
        if (this.mode !== "fs") {
          this.addGlobalTransientError(
            "Failed to get changes",
            now,
            `Missing data for patch ids: ${missingDataPatchIds.join(", ")}`,
          );
        }
      }
      return {
        status: "retry",
      };
    }

    if (this.initialPatchSyncCompletedAt === null) {
      this.initialPatchSyncCompletedAt = Date.now();
      // Emit even when didUpdatePatchSet is false: a project with no pending
      // patches still has to move usePatchSets off "not-asked", and the
      // patch-sets listener is the one it subscribes to.
      this.invalidatePatchSets();
    }
    return {
      status: "done",
    };
  }

  /**
   * Whether the first patch sync has completed, i.e. the patch sets can be
   * trusted to be empty-because-empty rather than empty-because-unread.
   */
  hasCompletedInitialPatchSync(): boolean {
    return this.initialPatchSyncCompletedAt !== null;
  }

  /**
   * Given the previous and the next list of global (server side) patch ids,
   * returns the modules whose ordered patch chain changed — i.e. the modules
   * whose patched source could now be different.
   *
   * Returns "all" if we cannot map every patch id to a module, in which case
   * the caller must fall back to syncing everything.
   */
  private getModulesAffectedByPatchIdChange(
    previous: PatchId[] | null,
    next: PatchId[],
  ): "all" | ModuleFilePath[] {
    if (previous === null) {
      return "all";
    }
    const groupByModule = (
      patchIds: PatchId[],
    ): Map<ModuleFilePath, PatchId[]> | null => {
      const byModule = new Map<ModuleFilePath, PatchId[]>();
      for (const patchId of patchIds) {
        const moduleFilePath = this.patchDataByPatchId[patchId]?.moduleFilePath;
        if (!moduleFilePath) {
          // We do not know which module this patch belongs to (syncPatches
          // could not fetch it), so we cannot reason about what changed.
          return null;
        }
        let patchIdsInModule = byModule.get(moduleFilePath);
        if (!patchIdsInModule) {
          patchIdsInModule = [];
          byModule.set(moduleFilePath, patchIdsInModule);
        }
        patchIdsInModule.push(patchId);
      }
      return byModule;
    };
    const previousByModule = groupByModule(previous);
    const nextByModule = groupByModule(next);
    if (previousByModule === null || nextByModule === null) {
      return "all";
    }
    const affected: ModuleFilePath[] = [];
    const allModuleFilePaths = new Set([
      ...previousByModule.keys(),
      ...nextByModule.keys(),
    ]);
    for (const moduleFilePath of allModuleFilePaths) {
      const previousPatchIds = previousByModule.get(moduleFilePath) || [];
      const nextPatchIds = nextByModule.get(moduleFilePath) || [];
      if (
        previousPatchIds.length !== nextPatchIds.length ||
        previousPatchIds.some((patchId, i) => patchId !== nextPatchIds[i])
      ) {
        affected.push(moduleFilePath);
      }
    }
    return affected;
  }

  private getChangedModules(
    changes: Record<ModuleFilePath, Set<SerializedSchema["type"] | "unknown">>,
  ): "all" | ModuleFilePath[] {
    // This is currently a pretty basic implementation to that figures out, based on a set of changes,
    // which modules needs to be synced.
    // It is meant to err on the side of caution, so it will return "all" if we cannot be a 100% certain
    const changedModules = Object.entries(changes);
    if (changedModules.length === 0) {
      return [];
    }
    if (changedModules.length === 1) {
      const [changedModuleFilePathS, types] = changedModules[0];
      if (
        Array.from(types).every((type) => nonInterDependentTypes.includes(type))
      ) {
        return [changedModuleFilePathS as ModuleFilePath];
      }
    }
    return "all";
  }

  // #region Sync
  public isSyncing = false;
  private MIN_WAIT_SECONDS = 1;
  private MAX_WAIT_SECONDS = 5;

  async sync(now: number): Promise<
    | {
        status: "done";
      }
    | {
        status: "retry";
        reason: RetryReason;
      }
  > {
    if (this.isSyncing) {
      // Already syncing, don't start a new sync
      return {
        status: "retry",
        reason: "already-syncing",
      };
    }
    if (this.isPublishing) {
      // Publishing, wait until complete before syncing
      return {
        status: "retry",
        reason: "publishing",
      };
    }
    let changedModules: "all" | ModuleFilePath[] = [];
    if (this.forceSyncAllModules) {
      this.forceSyncAllModules = false;
      changedModules = "all";
    }
    if (this.initializedAt === null) {
      // We are not initialized yet, so we need to sync everything
      changedModules = "all";
    }
    if (
      !this.localSchemas &&
      this.clientSideSchemaSha !== this.serverSideSchemaSha
    ) {
      // Schema has changed, so we need to sync everything.
      // Skip when local schemas are present: they're authoritative in fs mode,
      // and any genuine remote/local schema divergence in http mode is surfaced
      // via the blocking SchemaOutOfDateDialog rather than driving sync churn.
      changedModules = "all";
    }

    this.isSyncing = true;
    let pendingOps: PendingOp[] = [];
    let serverPatchIdsDidChange = false;
    const allSyncedPatchIds = new Set([
      ...this.syncedServerSidePatchIds,
      ...this.savedButNotYetGlobalServerSidePatchIds,
    ]);

    if (this.globalServerSidePatchIds && this.mode === "http") {
      // This will happen if there's patches that are deleted server side
      // that was created by the client
      for (const clientCreatedPatchId of allSyncedPatchIds) {
        if (
          // Client believes it has synced clientCreatedPatchId...
          // ... but it is no longer in the global server side patch ids
          // (this means that the patch id was removed from the server)
          !this.globalServerSidePatchIds.includes(clientCreatedPatchId)
        ) {
          // resetting the patches stored by client
          this.syncedServerSidePatchIds = [];
          this.savedButNotYetGlobalServerSidePatchIds = [];
          this.pendingClientPatchIds = [];
          await this.syncPatches(true, now);
          this.rebuildPatchIdsByModule();
          // in http mode we need to sync patches
          serverPatchIdsDidChange = true;
          break;
        }
      }
    }

    try {
      const changes: Record<
        ModuleFilePath,
        Set<SerializedSchema["type"] | "unknown">
      > = {};

      const lessThanNSecondsSince = (seconds: number, timestamp: number) => {
        const timeElapsed = now - timestamp;
        return timeElapsed <= seconds * 1000;
      };

      const moreThanNSecondsSince = (seconds: number, timestamp: number) => {
        const timeElapsed = now - timestamp;

        return timeElapsed >= seconds * 1000;
      };
      if (
        this.pendingOps[this.pendingOps.length - 1]?.updatedAt !== undefined &&
        // Less than N seconds ago since last op was updated - we should wait...
        lessThanNSecondsSince(
          this.MIN_WAIT_SECONDS,
          this.pendingOps[this.pendingOps.length - 1].updatedAt!,
        ) &&
        // ... unless if we have already waited more than N seconds - we still sync
        !moreThanNSecondsSince(
          this.MAX_WAIT_SECONDS,
          this.pendingOps[this.pendingOps.length - 1].createdAt,
        )
      ) {
        return {
          status: "retry",
          reason: "too-fast",
        };
      }
      // #region Write operations
      pendingOps = this.pendingOps.slice();
      this.pendingOps = [];
      let didWrite = false;
      while (pendingOps[0]) {
        const op = pendingOps[0];
        if (op.type === "add-patches") {
          try {
            const res = await this.executeAddPatches(op, changes, now);
            if (res.status !== "done") {
              return res;
            }
          } catch {
            return {
              status: "retry",
              reason: "error",
            };
          }
        } else if (op.type === "delete-patches") {
          try {
            const res = await this.executeDeletePatches(op, changes, now);
            if (res.status !== "done") {
              return res;
            } else {
              if (res.syncAllRequired && changedModules !== "all") {
                changedModules = "all";
              }
            }
          } catch {
            return {
              status: "retry",
              reason: "error",
            };
          }
        }
        didWrite = true;
        pendingOps.shift();
      }
      this.invalidatePendingOps();
      if (changedModules !== "all") {
        const currentChangedModules = this.getChangedModules(changes);
        if (currentChangedModules === "all") {
          changedModules = "all";
        } else {
          for (const moduleFilePath of currentChangedModules) {
            changedModules.push(moduleFilePath);
          }
        }
      }

      // #region Read operations
      if (
        this.clientSideSchemaSha === null ||
        this.schemas === null ||
        this.initializedAt === null
      ) {
        const res = await this.syncSchema();
        if (res.status !== "done") {
          return res;
        }
      }
      if (changedModules === "all" || changedModules.length > 0) {
        const path =
          // We could be smarter wrt to the modules we fetch.
          // However, note that we are not sure how long it takes to evaluate 1 vs many
          // - there' might not be that much to gain by being much more specific...
          // NOTE currently we're trying to optimize for the case where
          // there's a lot of changes in a single text / richtext field that needs to be synced
          // (e.g. an editor is typing inside a richtext / text field)
          changedModules !== "all" && changedModules.length === 1
            ? (changedModules[0] as ModuleFilePath)
            : undefined;

        // TODO: change sources endpoint so that you can have multiple moduleFilePaths
        // The studio client always treats /sources/~ as a pure un-patched
        // read: patch application and validation run on the client (via
        // getPatchedSource and the validation worker). Renders still come
        // from the server (they are computed on the patched sources there),
        // since the render select functions cannot be serialized.
        const sourcesRes = await this.client("/sources/~", "PUT", {
          path: path,
          query: {
            validate_sources: false,
            validate_binary_files: false,
            exclude_patches: false,
            apply_patches: false,
          },
        });
        if (sourcesRes.status !== null) {
          this.resetNetworkError();
        }
        if (
          sourcesRes.status === null &&
          sourcesRes.json.type === "network_error"
        ) {
          this.addNetworkError(now);
          return {
            status: "retry",
            reason: "network-error",
          };
        } else if (sourcesRes.status !== 200) {
          this.addGlobalTransientError(
            "Could not sync content with server. Please wait or reload the application.",
            now,
            sourcesRes.json.message,
          );
        } else {
          // Clean up validation errors
          const changedValidationErrors = new Set<SourcePath>();
          for (const sourcePathS in this.errors.validationErrors) {
            const sourcePath = sourcePathS as SourcePath;
            if (path === undefined || sourcePath.startsWith(path)) {
              changedValidationErrors.add(sourcePath);
              if (this.errors.validationErrors[sourcePath]) {
                this.errors.validationErrors = {
                  ...this.errors.validationErrors,
                  [sourcePath]: undefined,
                };
              }
            }
          }
          for (const [moduleFilePathS, valModule] of Object.entries(
            sourcesRes.json.modules,
          )) {
            const moduleFilePath = moduleFilePathS as ModuleFilePath;
            if (valModule) {
              if (this.serverSources === null) {
                this.serverSources = {};
              }
              // A full sync returns every module, but typically only a few of
              // them (often none) actually changed on disk. Invalidating the
              // untouched ones would re-render every subscriber and re-run the
              // validation worker for the whole project on every sync tick, so
              // compare first and only invalidate what really moved.
              const previousSource = this.serverSources[moduleFilePath];
              const sourceDidChange =
                previousSource === undefined ||
                !deepEqual(previousSource, valModule.source);
              // With apply_patches=false on /sources/~, valModule.source is
              // the un-patched source. The patched view is computed by
              // getPatchedSource folding the known patch chain on top.
              this.serverSources[moduleFilePath] = valModule.source;
              // The entry SET moved with the source (a key added, removed or
              // renamed rewrites the `.val.ts`), so the loaded entries have to be
              // refetched. Gated on `sourceDidChange` so a full sync — every
              // module comes back on every tick — does not refetch hundreds of
              // unchanged entries. A content-only edit leaves the source
              // byte-identical and is caught by the two signals that DO see it:
              // `jsonEntriesSha` on the stat (fs) and `markAllJsonEntriesStale`
              // in `publish`.
              if (sourceDidChange) {
                this.markJsonEntriesStale(moduleFilePath);
              }
              // The server render is the FALLBACK for computeRender: that one
              // runs the user's own schema instance against the patched source,
              // but returns null when there are no instances (the host app does
              // not render `<ValModulesClient>`). So keep recording what the
              // server sent — #470 restored it on /sources/~ precisely because
              // `select` cannot be serialized, and without it such an app has no
              // renders at all.
              if (this.renders === null) {
                this.renders = {};
              }
              // Reference comparison is enough here: a render that actually
              // came back from the server is always a fresh object, so this
              // only skips the emit when the render stayed null.
              const previousRender = this.renders[moduleFilePath] ?? null;
              const nextRender = valModule.render || null;
              this.renders[moduleFilePath] = nextRender;
              // Either the server render moved, or the source did - a client
              // render is computed from the patched source, so it has to be
              // recomputed when that changes. Gated so a full sync (every module
              // on every tick) does not recompute the untouched ones.
              if (previousRender !== nextRender || sourceDidChange) {
                this.invalidateRenders(moduleFilePath);
              }
              if (sourceDidChange) {
                // Drop any cached patched view for this module; the next read
                // rebuilds from the fresh un-patched source.
                if (this.patchedSourcesCache !== null) {
                  this.patchedSourcesCache = {
                    ...this.patchedSourcesCache,
                    [moduleFilePath]: undefined,
                  };
                }
                console.debug("Invalidating source", moduleFilePath);
                // invalidateSource schedules the overlay emission itself, with
                // the PATCHED source. Emitting `valModule.source` here would
                // push the committed content — this endpoint is called with
                // apply_patches:false — and the host's client components would
                // render the editor's unpublished work away.
                this.invalidateSource(moduleFilePath);
                // Validation always runs client-side via the worker now —
                // /sources/~ is called with validate_sources=false.
                this.requestModuleValidation(moduleFilePath);
              }
              const nextPatchErrors = valModule.patches?.errors;
              if (nextPatchErrors !== undefined) {
                if (this.errors.patchErrors === undefined) {
                  this.errors.patchErrors = {};
                }
                // Merge rather than replace, and do NOT clear when absent.
                //
                // The studio always reads /sources/~ with apply_patches=false,
                // and on that path the server never computes patch errors at
                // all: `patchErrors` is derived from `sourcesRes.errors`, which
                // is only populated inside the `if (applyPatches)` branch. So
                // `undefined` here means "not computed", NOT "no errors", and
                // clearing on it would wipe what the client and /save found on
                // every stat tick - which is the whole conflicting-changes
                // feature.
                //
                // Nor does a server-reported failure resolve itself: /save
                // applies patches to the `.val.ts` AST while the client applies
                // them to the evaluated json, so the client cannot conclude the
                // AST side now succeeds. Client-side entries ARE pruned, by
                // recordClientPatchErrors on a full-chain recompute.
                const previous = this.errors.patchErrors[moduleFilePath] ?? {};
                const merged: Record<PatchId, PatchErrorEntry> = {
                  ...previous,
                  ...Object.fromEntries(
                    Object.entries(nextPatchErrors).map(
                      ([patchId, error]): [string, PatchErrorEntry] => [
                        patchId,
                        { message: error.message, source: "server" },
                      ],
                    ),
                  ),
                };
                // Only emit when something actually moved: this runs per module
                // on every stat tick, and re-reporting the same set would
                // re-render every subscriber for nothing.
                if (!deepEqual(previous, merged)) {
                  this.errors.patchErrors[moduleFilePath] = merged;
                  this.invalidatePatchErrors(moduleFilePath);
                }
              }
              for (const syncedPatchId of valModule.patches?.applied || []) {
                this.syncedServerSidePatchIds.push(syncedPatchId);
              }
              for (const syncedPatchId of valModule.patches?.skipped || []) {
                this.syncedServerSidePatchIds.push(syncedPatchId);
              }
            } else {
              this.addGlobalTransientError(
                `Could not find '${moduleFilePath}' in server reply`,
                now,
                "This is most likely a bug",
              );
            }
            this.markAllSyncStatusIn(moduleFilePath, "done");
          }
          //  Invalidate validation errors:
          // if (changedValidationErrors.size > 0) {
          this.invalidateAllValidationErrors();
          // }
          for (const sourcePath of Array.from(changedValidationErrors)) {
            this.invalidateValidationError(sourcePath);
          }

          // Sync Schema if it changed:
          if (sourcesRes.json.schemaSha !== this.clientSideSchemaSha) {
            await this.syncSchema();
          }
        }
      }

      if (
        this.autoPublish &&
        this.mode === "fs" &&
        this.globalServerSidePatchIds &&
        this.globalServerSidePatchIds.length > 0
      ) {
        const surfacedValidationErrors = this.getAllValidationErrorsSnapshot();
        const hasValidationError = Object.values(
          surfacedValidationErrors || {},
        ).some((errors) => errors && errors.length > 0);
        if (!hasValidationError) {
          await this.publish(
            this.globalServerSidePatchIds.concat(
              ...Array.from(this.syncedServerSidePatchIds),
            ),
            undefined,
            now,
          );
          didWrite = true;
        } else {
          console.debug(
            "Skip auto-publish since there's validation errors",
            surfacedValidationErrors,
          );
        }
      }
      if (serverPatchIdsDidChange || didWrite) {
        this.invalidatePendingClientSidePatchIds();
        this.invalidateGlobalServerSidePatchIds();
        this.invalidateSyncedServerSidePatchIds();
        this.invalidateSavedServerSidePatchIds();
      }
      return {
        status: "done",
      };
    } finally {
      this.isSyncing = false;
      this.pendingOps = [...pendingOps, ...this.pendingOps];
    }
  }

  // #region Publish
  async publish(
    patchIds: PatchId[],
    message: string | undefined,
    now: number,
  ): Promise<PublishResult> {
    try {
      if (this.isPublishing) {
        console.debug("Already publishing changes", now);
        return {
          status: "retry",
          reason: "already-publishing",
        };
      }
      this.isPublishing = true;
      if (this.publishDisabled) {
        console.debug(
          "Could not publish changes, since the publish is disabled",
          now,
        );
        return {
          status: "retry",
          reason: "publish-disabled",
        };
      }
      this.publishDisabled = true;
      this.invalidatePublishDisabled();

      // Custom validators only run on update of their own module, so a module
      // edited before a validator existed (or edited in another session) has never
      // had them run. Do it now, before the gate below reads the errors — that is
      // what makes the pre-publish check complete rather than merely recent.
      await this.runCustomValidationForPatches(patchIds);

      const surfacedValidationErrors = this.getAllValidationErrorsSnapshot();
      const hasValidationError =
        Object.values(surfacedValidationErrors || {}).flatMap(
          (errors) => errors || [],
        ).length > 0;
      if (hasValidationError) {
        console.debug(
          "Skipping publish since there's validation errors",
          surfacedValidationErrors,
        );
        this.addGlobalTransientError(
          "Could not publish changes, since there are validation errors",
          now,
        );
        return {
          status: "retry",
          reason: "validation-error",
        };
      }
      if (patchIds.length === 0) {
        this.addGlobalTransientError(
          "Could not publish changes, since there are no changes to publish",
          Date.now(),
        );
        return {
          status: "done",
        };
      }
      const res = await this.client("/save", "POST", {
        body: {
          message: message,
          patchIds: patchIds,
        },
      });
      if (res.status === null) {
        this.addGlobalTransientError(
          "Network error: could not publish",
          Date.now(),
        );
        return {
          status: "retry",
        };
      } else if (res.status !== 200) {
        // /save reports which patches it could not apply. Keeping only the
        // message left editors with "Failed to publish changes" and no way to
        // find the offending change, so record them against the patch ids: this
        // is the only way TS-AST-only failures ever reach the studio, since the
        // client applies patches to the evaluated json and cannot see them.
        const recordedPatchErrors = this.recordServerPatchErrors(res.json);
        this.addGlobalTransientError(
          recordedPatchErrors > 0
            ? `Could not publish: ${recordedPatchErrors} change${recordedPatchErrors === 1 ? "" : "s"} cannot be applied. Review them to continue.`
            : "Failed to publish changes",
          Date.now(),
          res.json.message,
        );
        return {
          status: "retry",
        };
      } else {
        // BEFORE the baking below, which replaces serverSources with an ALREADY
        // patched source — folding after that would apply the same patches a
        // second time. Best-effort: the refetch that markAllJsonEntriesStale
        // kicks off is what makes the cache correct, this only keeps it from
        // being visibly wrong in the meantime, so a throw here must not report a
        // save that DID commit as failed.
        try {
          this.foldPublishedJsonEntriesIntoCommitted(patchIds);
        } catch (err) {
          console.error(
            "Val: SyncEngine: could not fold published json entries into the committed cache",
            err,
          );
        }
        // In fs mode /save applies exactly these patches to the .val files and
        // then deletes them. Since serverSources still holds the *un-patched*
        // base (we read /sources/~ with apply_patches=false), dropping the patch
        // chain below would momentarily revert affected fields to their
        // pre-patch value until the next stat-triggered /sources/~ refresh.
        // Bake the current optimistic (patched) value into serverSources first
        // so the base swaps out from under the optimistic view atomically and
        // the displayed value never changes. The later /sources/~ overwrites
        // serverSources with the authoritative value (self-healing if it
        // differs). Only safe in fs mode: in http mode the committed patches
        // persist server-side and are re-applied by syncPatches, so the base
        // must stay un-patched (baking would double-apply).
        const affectedModules: ModuleFilePath[] = [];
        if (this.mode === "fs") {
          for (const moduleFilePath of this.patchIdsByModuleFilePath.keys()) {
            const patched = this.sourceAsSavedToDisk(moduleFilePath);
            if (patched !== undefined && this.serverSources) {
              this.serverSources[moduleFilePath] = patched;
              if (this.patchedSourcesCache !== null) {
                this.patchedSourcesCache = {
                  ...this.patchedSourcesCache,
                  [moduleFilePath]: undefined,
                };
              }
              affectedModules.push(moduleFilePath);
            }
          }
          // In fs mode we delete all patch ids, so we start fresh
          this.globalServerSidePatchIds = [];
          console.debug("Deleting all patch ids");
        }
        this.pendingClientPatchIds = [];
        this.syncedServerSidePatchIds = [];
        this.savedButNotYetGlobalServerSidePatchIds = [];
        this.patchIdsByCreatorId = new Map();
        this.patchIdsByModuleFilePath = new Map();
        this.patchDataByPatchId = {};
        this.patchSets = new PatchSets();
        // The published content is now the committed content: any loaded
        // `.jsonValues()` entry must be refetched (see markAllJsonEntriesStale).
        this.markAllJsonEntriesStale();
        const fullReset = true;
        await this.syncPatches(fullReset, now);
        this.invalidatePatchSets();
        this.invalidateAllPatches();
        this.invalidatePendingClientSidePatchIds();
        this.invalidateSyncedServerSidePatchIds();
        this.invalidateSavedServerSidePatchIds();
        // We emptied globalServerSidePatchIds above (fs), so its snapshot must be
        // invalidated too — otherwise the Save button re-reads a stale non-empty
        // value when the finally clears publishDisabled, briefly flicking back to
        // enabled before the next stat/sync corrects it.
        this.invalidateGlobalServerSidePatchIds();
        // Notify subscribers so they re-read the freshly baked-in base. The
        // value is unchanged from the optimistic view, so there's no flicker;
        // only the snapshot's `optimistic` flag flips to false (now published).
        for (const moduleFilePath of affectedModules) {
          this.invalidateSource(moduleFilePath);
        }
        // Last, so that everything a publish-aware view re-reads when it
        // rebuilds (patch sets, patches, sources) is already up to date.
        this.publishCount++;
        this.invalidatePublishCount();
        return {
          status: "done",
        };
      }
    } catch (err) {
      console.error("Error while publishing", err);
      this.addGlobalTransientError(
        "Failed to publish changes",
        Date.now(),
        (err as Error).message,
      );
      return {
        status: "retry",
        reason: "error",
      };
    } finally {
      this.isPublishing = false;
      this.publishDisabled = false;
      this.invalidatePublishDisabled();
    }
  }

  resetNetworkError() {
    this.errors.hasNetworkErrorTimestamp = null;
    this.invalidateNetworkError();
  }

  addNetworkError(now: number) {
    this.errors.hasNetworkErrorTimestamp = now;
    this.invalidateNetworkError();
  }

  resetSchemaError() {
    this.errors.hasSchemaErrorTimestamp = null;
    this.invalidateSchemaError();
  }

  addSchemaError(now: number) {
    this.errors.hasSchemaErrorTimestamp = now;
    this.invalidateSchemaError();
  }

  addGlobalTransientError(message: string, now: number, details?: string) {
    if (!this.errors.globalTransientErrorQueue) {
      this.errors.globalTransientErrorQueue = [];
    }
    console.error("Global transient error", message, details || "");
    this.errors.globalTransientErrorQueue.push({
      message,
      details,
      timestamp: now,
      id: crypto.randomUUID(),
    });
    // Keep the in-memory history bounded - this is a transient/debugging list.
    const MAX_TRANSIENT_ERRORS = 100;
    if (this.errors.globalTransientErrorQueue.length > MAX_TRANSIENT_ERRORS) {
      this.errors.globalTransientErrorQueue =
        this.errors.globalTransientErrorQueue.slice(-MAX_TRANSIENT_ERRORS);
    }
    this.invalidateGlobalTransientErrors();
  }

  removeGlobalTransientErrors(ids: string[]) {
    if (this.errors.globalTransientErrorQueue) {
      const idsSet = new Set(ids);
      this.errors.globalTransientErrorQueue =
        this.errors.globalTransientErrorQueue.filter(
          (error) => !idsSet.has(error.id),
        );
      this.invalidateGlobalTransientErrors();
    }
  }

  /**
   * Mock method for testing and Storybook.
   * Sets schemas directly and invalidates related caches.
   */
  setSchemas(
    schemas: Record<ModuleFilePath, SerializedSchema | undefined>,
  ): void {
    this.schemas = schemas;
    this.cachedSchemaSnapshots = null;
    this.cachedAllSchemasSnapshot = null;
    this.cachedDeserializedSchemas = null;
    this.emit(this.listeners["schema"]?.[globalNamespace]);
  }

  /**
   * Mock method for testing and Storybook.
   * Sets serverSources (the un-patched view) and invalidates related caches.
   * Note: any patched view is computed on demand from `serverSources` plus
   * the known patch chain; tests that want a patched view should also seed
   * patchDataByPatchId / pendingClientPatchIds.
   */
  setSources(sources: Record<ModuleFilePath, JSONValue | undefined>): void {
    this.serverSources = sources;
    this.patchedSourcesCache = null;
    this.cachedSourceSnapshots = null;
    this.cachedServerSourceSnapshots = null;
    this.cachedBaseSourceSnapshots = null;
    this.cachedAllSourcesSnapshot = null;
    this.cachedSourcesSnapshot = null;
    for (const moduleFilePath in sources) {
      this.emit(this.listeners["sources"]?.[moduleFilePath as ModuleFilePath]);
      this.emit(this.listeners["source"]?.[moduleFilePath as ModuleFilePath]);
    }
    this.emit(this.listeners["all-sources"]?.[globalNamespace]);
  }

  /**
   * Mock method for testing and Storybook.
   * Sets renders directly and invalidates related caches.
   */
  setRenders(renders: Record<ModuleFilePath, ReifiedRender | null>): void {
    this.renders = renders;
    this.cachedRenderSnapshots = renders;
    this.cachedAllRendersSnapshot = null;
    for (const moduleFilePath in renders) {
      const path = moduleFilePath as ModuleFilePath;
      this.emit(this.listeners["render"]?.[path]);
    }
    this.emit(this.listeners["all-renders"]?.[globalNamespace]);
  }

  /**
   * Mock method for testing and Storybook.
   * Sets initializedAt directly and invalidates related caches.
   */
  setInitializedAt(timestamp: number): void {
    this.initializedAt = timestamp;
    this.cachedInitializedAtSnapshot = null;
    this.emit(this.listeners["initialized-at"]?.[globalNamespace]);
  }

  /**
   * Mock method for testing and Storybook.
   * Sets baseSha so that getParentRef() returns a valid ref,
   * which allows the sync loop to flush pending ops.
   */
  setBaseSha(sha: string): void {
    this.baseSha = sha;
    this.cachedParentRef = undefined;
  }
}

// #region Supporting code
const ops = new JSONOps();
const globalNamespace = "global";
/**
 * How many `.jsonValues()` entries one `/json` request asks for. Smaller than
 * the server's hard cap so a chunk stays a modest URL and lands incrementally
 * (each landed chunk re-renders the rows it covers).
 */
const JSON_ENTRIES_CHUNK_SIZE = Math.min(50, JSON_ENTRIES_BATCH_MAX);
/**
 * How many times `loadJsonEntriesSettled` re-passes while entries it asked for are
 * still outstanding. A backstop against an invalidation that keeps landing
 * mid-flight, not a computed limit — exhausting it is logged, since "incomplete"
 * with no errors is otherwise a mystery.
 */
const JSON_ENTRIES_MAX_LOAD_PASSES = 3;

/**
 * How long to coalesce overlay emissions. Long enough that a burst of keystrokes
 * is one emission, short enough that the host app's client components feel live.
 * The host's own `router.refresh()` loop runs at 500ms, so this is not the
 * bottleneck.
 */
const OVERLAY_EMIT_DEBOUNCE_MS = 100;

/**
 * How long a custom-validation run may hold the main thread before yielding.
 * ~5ms keeps it well inside a frame; the user's own slow validator can still
 * overrun a slice, which is theirs to fix.
 */
const CUSTOM_VALIDATION_SLICE_MS = 5;

/** Progress of the current `.jsonValues()` entry load run. */
export type JsonEntriesProgress = {
  status: "idle" | "loading";
  /** Keys resolved so far — loaded, missing or failed all count as resolved. */
  loaded: number;
  /** Keys requested in this run; 0 when idle. */
  total: number;
  /** 0-100, and 100 when idle. */
  percentage: number;
};
/**
 * These are types where we can be 100% certain that a change in this type, will not result in validations failing in some other module.
 * We use this to determine if syncing 1 module is enough or if we need to sync all modules.
 */
const nonInterDependentTypes = [
  "string",
  "boolean",
  "number",
  "date",
  "dateTime",
  "color",
  "richtext",
  "file",
  "image",
];
export const defaultOverlayEmitter = (
  moduleFilePath: ModuleFilePath,
  newSource: JSONValue,
) => {
  window.dispatchEvent(
    new CustomEvent("val-event", {
      detail: {
        type: "source-update",
        moduleFilePath,
        source: newSource,
      },
    }),
  );
};

// #region Types
/**
 * A patch that could not be applied.
 *
 * `source` records who found it, because the two cannot see the same things:
 * the client applies patches to the evaluated json with JSONOps, while /save
 * applies them to the `.val.ts` AST. A patch can apply here and still be
 * rejected there (a `c.image` metadata key that is not literally present, a
 * non-literal initializer, an array shorter in the source than in the evaluated
 * json), so the client must never conclude that a server-reported failure has
 * resolved itself.
 */
export type PatchErrorEntry = {
  message: string;
  /**
   * Required, not optional: `recordClientPatchErrors` drops every entry that is
   * not `"server"` on a full-chain recompute, so an entry without a source would
   * be silently discarded. Every construction site sets it, and these entries
   * only ever live in memory - there is no stored data to be missing it.
   */
  source: "client" | "server";
};

/**
 * `publish` has its own reasons — it can be turned away before it ever gets to
 * the patches, and none of {@link RetryReason}'s sync reasons apply to it.
 */
type PublishRetryReason =
  | "already-publishing"
  | "publish-disabled"
  | "validation-error"
  | "error";
type PublishResult =
  | { status: "done" }
  // No reason on the network / non-200 paths: the transient error already says
  // what happened, and the caller only distinguishes done from not-done.
  | { status: "retry"; reason?: PublishRetryReason };

type RetryReason =
  | "conflict"
  | "not-initialized"
  | "network-error"
  | "too-fast"
  | "publishing"
  | "error"
  | "patch-ids-changed"
  | "already-syncing"
  | "schema-out-of-date";
export type LocalModulesStatus =
  | { type: "absent" }
  | { type: "loading" }
  | {
      type: "loaded";
      schemaSha: string;
      sourcesSha: string;
      moduleCount: number;
    }
  | {
      type: "error";
      moduleErrors: ExtractedModuleError[];
    };

type SyncEngineListenerType =
  | "schema"
  | "initialized-at"
  | "auto-publish"
  | "parent-ref"
  | "sync-status"
  | "patch-sets"
  | "all-patches"
  | "validation-error"
  | "all-validation-errors"
  | "global-transient-errors"
  | "failed-patches"
  | "skipped-patches"
  | "network-error"
  | "schema-error"
  | "global-server-side-patch-ids"
  | "pending-client-side-patch-ids"
  | "synced-server-side-patch-ids"
  | "saved-server-side-patch-ids"
  | "publish-disabled"
  | "published"
  | "schema-out-of-date"
  | "local-modules-status"
  | "pending-ops-count"
  | "json-entries-progress"
  | "all-sources"
  | "all-renders"
  | "render"
  | "source"
  | "sources"
  | "patch-errors";
type SyncStatus = "not-asked" | "fetching" | "patches-pending" | "done";
type CommonOpProps<T> = T & {
  createdAt: number;
  updatedAt?: number;
};
type AddPatchOp = CommonOpProps<{
  type: "add-patches";
  data: Record<
    ModuleFilePath,
    { patch: Patch; type: SerializedSchema["type"]; patchId: PatchId }[]
  >;
  sessionId?: string | null;
}>;
type DeletePatchesOp = CommonOpProps<{
  type: "delete-patches";
  patchIds: PatchId[];
}>;
type PendingOp = AddPatchOp | DeletePatchesOp;
