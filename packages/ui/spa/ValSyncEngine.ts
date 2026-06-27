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
  ParentRef,
  ValClient,
  Patch,
  resolveSchemaSourceFixes,
} from "@valbuild/shared/internal";
import { canMerge } from "./utils/mergePatches";
import { PatchSets, SerializedPatchSet } from "./utils/PatchSets";
import { ReifiedRender } from "@valbuild/core";
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
      Record<PatchId, { message: string }> | null
    >;
  }>;
  /**
   * If this is true, the next sync (and only the next) will sync all modules
   *
   * We use this if there's unknown patch ids or to initialize
   */
  private forceSyncAllModules: boolean;

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
    this.forceSyncAllModules = true;
    this.errors = {};
    this.listeners = {};
    this.syncStatus = {};
    this.schemas = null;
    this.serverSideSchemaSha = null;
    this.clientSideSchemaSha = null;
    this.localSchemas = null;
    this.localSchemaSha = null;
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
    this.forceSyncAllModules = true;
    this.errors = {};
    this.listeners = {};
    this.syncStatus = {};
    this.schemas = null;
    this.serverSideSchemaSha = null;
    this.clientSideSchemaSha = null;
    this.localSchemas = null;
    this.localSchemaSha = null;
    this.localSources = null;
    this.localSourcesSha = null;
    this.localModulesStatus = { type: "absent" };
    this.schemaOutOfDate = false;
    this.sourcesSha = null;
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

    this.invalidateInitializedAt();
  }

  // #region Subscribe
  private listeners: Partial<
    Record<SyncEngineListenerType, Record<string, (() => void)[]>>
  >;
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
    const p = path || globalNamespace;
    return (listener: () => void) => {
      // Our TS version is too low to figure out what is possible undefined here, so we do any's...
      // On TS 5.8+ we should be able to remove const listeners and replace listeners with this.listeners
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listeners = this.listeners as any;
      if (!listeners[type]) {
        listeners[type] = {};
      }
      if (Array.isArray(p)) {
        const indices: number[] = [];
        for (const path of p) {
          if (!listeners[type][path]) {
            listeners[type][path] = [];
          }
          const idx = listeners[type][path].push(listener) - 1;
          indices.push(idx);
        }
        return () => {
          for (const idx of indices) {
            listeners[type]?.[p[idx]]?.splice(idx, 1);
          }
        };
      } else {
        if (!listeners[type][p]) {
          listeners[type][p] = [];
        }
        const idx = listeners[type][p].push(listener) - 1;
        return () => {
          listeners[type]?.[p].splice(idx, 1);
        };
      }
    };
  }
  private emit(listeners?: (() => void)[]) {
    if (listeners) {
      for (const listener of listeners) {
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

  private invalidateSource(moduleFilePath: ModuleFilePath) {
    if (this.cachedSourceSnapshots !== null) {
      const keysToRemove: string[] = [];
      for (const key in this.cachedSourceSnapshots) {
        if (key === moduleFilePath || key.startsWith(moduleFilePath + "\0")) {
          keysToRemove.push(key);
        }
      }
      if (keysToRemove.length > 0) {
        const next = { ...this.cachedSourceSnapshots };
        for (const key of keysToRemove) {
          delete next[key];
        }
        this.cachedSourceSnapshots = next;
      }
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
  }

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
      [moduleFilePath]: null,
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
    ReifiedRender | null
  > | null;
  getRenderSnapshot(moduleFilePath: ModuleFilePath) {
    if (this.cachedRenderSnapshots === null) {
      this.cachedRenderSnapshots = {};
    }
    if (this.cachedRenderSnapshots[moduleFilePath] === null) {
      this.cachedRenderSnapshots[moduleFilePath] =
        this.renders?.[moduleFilePath] || null;
    }
    return this.cachedRenderSnapshots[moduleFilePath];
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
  private getPatchedSource(
    moduleFilePath: ModuleFilePath,
  ): JSONValue | undefined {
    const baseSource = this.serverSources?.[moduleFilePath];
    if (baseSource === undefined) return undefined;
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
        // skip a failing patch — server-side patch analysis would report
        // this as an error/skip; don't pollute the cache with the bad state
        prefixIntact = false;
        console.debug("ValSyncEngine: skipping unappliable client-side patch", {
          patchId,
          moduleFilePath,
          message: patchRes.error.message,
        });
      }
    }

    this.patchedSourcesCache[moduleFilePath] = {
      patchIds: nextIds.slice(0, appliedPrefixLen),
      source: appliedPrefixSource,
    };
    return current;
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
    string,
    | {
        status: "success";
        data: Json;
        optimistic: boolean;
      }
    | {
        data?: undefined;
        status: "no-schemas" | "source-not-found" | "schema-not-found";
        message?: string;
      }
  > | null;
  getSourceSnapshot(sourcePath: ModuleFilePath, creatorId?: string) {
    if (this.cachedSourceSnapshots === null) {
      this.cachedSourceSnapshots = {};
    }
    const cacheKey = creatorId ? `${sourcePath}\0${creatorId}` : sourcePath;
    if (this.cachedSourceSnapshots[cacheKey] === undefined) {
      const moduleData = this.getPatchedSource(sourcePath);
      if (this.schemas === null) {
        this.cachedSourceSnapshots[cacheKey] = {
          status: "no-schemas",
        };
      } else if (!this.schemas[sourcePath]) {
        this.cachedSourceSnapshots[cacheKey] = {
          status: "schema-not-found",
        };
      } else if (moduleData === undefined) {
        this.cachedSourceSnapshots[cacheKey] = {
          status: "source-not-found",
        };
      } else {
        this.cachedSourceSnapshots[cacheKey] = {
          status: "success",
          data: deepClone(moduleData),
          optimistic: this.isEditedByComponent(sourcePath, creatorId),
        };
      }
    }
    return this.cachedSourceSnapshots[cacheKey];
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
      if (this.renders) {
        for (const moduleFilePathS in this.renders) {
          const moduleFilePath = moduleFilePathS as ModuleFilePath;
          this.cachedAllRendersSnapshot[moduleFilePath] =
            this.renders[moduleFilePath];
        }
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
  private cachedDeserializedSchemas: Record<
    ModuleFilePath,
    Schema<SelectorSource>
  > | null;
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
    Record<ModuleFilePath, Record<PatchId, { message: string }> | null>
  > | null;
  getPatchErrorsSnapshot(
    moduleFilePaths: ModuleFilePath[],
  ):
    | Record<ModuleFilePath, Record<PatchId, { message: string }> | null>
    | undefined {
    const pathsKey = moduleFilePaths.sort().join("|");
    // TODO: not quite sure this works well, however it is only used in one place and seems to work there - something to revise!
    if (this.cachedPatchErrorsSnapshot === null) {
      this.cachedPatchErrorsSnapshot = {};
      const result: Record<
        ModuleFilePath,
        Record<PatchId, { message: string }> | null
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
        (moduleFilePath, errors) => {
          this.applyValidationResult(moduleFilePath, errors);
        },
        this.createValidationWorker,
      );
    }
    return this.validationWorker;
  }

  private requestModuleValidation(moduleFilePath: ModuleFilePath): void {
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
    this.ensureValidationWorker().validate(
      moduleFilePath,
      source as Source,
      serializedSchema,
      schemaSha,
    );
  }

  private requestAllModuleValidation(): void {
    const schemas = this.schemas;
    if (!schemas) return;
    for (const moduleFilePath of Object.keys(schemas) as ModuleFilePath[]) {
      this.requestModuleValidation(moduleFilePath);
    }
  }

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
    if (!this.cachedDeserializedSchemas) {
      this.cachedDeserializedSchemas = {};
    }
    if (!this.cachedDeserializedSchemas[moduleFilePath]) {
      this.cachedDeserializedSchemas[moduleFilePath] =
        deserializeSchema(serializedSchema);
    }
    const schema = this.cachedDeserializedSchemas[moduleFilePath];
    return schema["executeValidate"](
      moduleFilePath as string as SourcePath,
      patchRes.value,
    );
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
    this.requestModuleValidation(moduleFilePath);
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
    this.requestModuleValidation(moduleFilePath);
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
        this.requestModuleValidation(moduleFilePath);

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
        this.requestModuleValidation(moduleFilePath);

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
      this.requestModuleValidation(moduleFilePath);

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
    this.sourcesSha = sourcesSha;
    this.baseSha = baseSha;
    this.mode = mode;
    if (
      this.serverSideSchemaSha !== schemaSha ||
      this.commitSha !== commitSha
    ) {
      if (haveLocal) {
        // Local schemas are authoritative. Flag the divergence (http-only
        // dialog) but do NOT reset+init — that would discard local state.
        // Source-sync below continues to run: source updates remain useful
        // even while the schema-out-of-date dialog is open.
        this.serverSideSchemaSha = schemaSha;
        this.commitSha = commitSha;
        this.recomputeSchemaOutOfDate();
      } else {
        // No local: classic reset+init. The new SHAs are stashed AFTER
        // reset() (which clears them) so the recursive init's stat-compare
        // doesn't immediately re-trigger the reset path.
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
    }
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
    if (
      !this.forceSyncAllModules &&
      (sourcesShaDidChange || patchIdsDidChange)
    ) {
      this.forceSyncAllModules = true;
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
    }
    return {
      status: "done",
      syncAllRequired,
    };
  }

  async setValModules(valModules: ValModules | null): Promise<void> {
    if (!valModules) {
      this.localSchemas = null;
      this.localSchemaSha = null;
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
      if (this.clientSideSchemaSha !== schemaRes.json.schemaSha) {
        this.clientSideSchemaSha = schemaRes.json.schemaSha;
      }

      console.debug("Invalidating schema");
      this.resetSchemaError();
      this.invalidateSchema();
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

    return {
      status: "done",
    };
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
        // getPatchedSource and the validation worker). The server's
        // apply_patches=false branch skips render generation too.
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
              // With apply_patches=false on /sources/~, valModule.source is
              // the un-patched source. The patched view is computed by
              // getPatchedSource folding the known patch chain on top.
              this.serverSources[moduleFilePath] = valModule.source;
              // render is always null in the new mode; keep the renders map
              // up-to-date for any downstream code that still subscribes.
              if (this.renders === null) {
                this.renders = {};
              }
              this.renders[moduleFilePath] = valModule.render || null;
              this.invalidateRenders(moduleFilePath);
              // Drop any cached patched view for this module; the next read
              // rebuilds from the fresh un-patched source.
              if (this.patchedSourcesCache !== null) {
                this.patchedSourcesCache = {
                  ...this.patchedSourcesCache,
                  [moduleFilePath]: undefined,
                };
              }
              console.debug("Invalidating source", moduleFilePath);
              this.invalidateSource(moduleFilePath);
              this.overlayEmitter?.(moduleFilePath, valModule.source);
              this.invalidatePatchErrors(moduleFilePath);
              if (valModule.patches?.errors) {
                if (this.errors.patchErrors === undefined) {
                  this.errors.patchErrors = {};
                }
                this.errors.patchErrors[moduleFilePath] = valModule.patches
                  .errors as Record<PatchId, { message: string }>;
              }
              // Validation always runs client-side via the worker now —
              // /sources/~ is called with validate_sources=false.
              this.requestModuleValidation(moduleFilePath);
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
  async publish(patchIds: PatchId[], message: string | undefined, now: number) {
    try {
      if (this.isPublishing) {
        console.debug("Already publishing changes", now);
        return {
          status: "retry",
          reason: "already-publishing",
        } as const;
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
        } as const;
      }
      this.publishDisabled = true;
      this.invalidatePublishDisabled();

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
        } as const;
      }
      if (patchIds.length === 0) {
        this.addGlobalTransientError(
          "Could not publish changes, since there are no changes to publish",
          Date.now(),
        );
        return {
          status: "done",
        } as const;
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
        } as const;
      } else if (res.status !== 200) {
        this.addGlobalTransientError(
          "Failed to publish changes",
          Date.now(),
          res.json.message,
        );
        return {
          status: "retry",
        } as const;
      } else {
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
            const patched = this.getPatchedSource(moduleFilePath);
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
        const fullReset = true;
        await this.syncPatches(fullReset, now);
        this.invalidatePatchSets();
        this.invalidateAllPatches();
        this.invalidatePendingClientSidePatchIds();
        this.invalidateSyncedServerSidePatchIds();
        this.invalidateSavedServerSidePatchIds();
        // Notify subscribers so they re-read the freshly baked-in base. The
        // value is unchanged from the optimistic view, so there's no flicker;
        // only the snapshot's `optimistic` flag flips to false (now published).
        for (const moduleFilePath of affectedModules) {
          this.invalidateSource(moduleFilePath);
        }
        return {
          status: "done",
        } as const;
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
      } as const;
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
 * These are types where we can be 100% certain that a change in this type, will not result in validations failing in some other module.
 * We use this to determine if syncing 1 module is enough or if we need to sync all modules.
 */
const nonInterDependentTypes = [
  "string",
  "boolean",
  "number",
  "date",
  "dateTime",
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
  | "schema-out-of-date"
  | "local-modules-status"
  | "pending-ops-count"
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
