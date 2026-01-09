import {
  Internal,
  Json,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import {
  applyPatch,
  deepClone,
  deepEqual,
  JSONOps,
  JSONValue,
  Patch,
  ReadonlyJSONValue,
} from "@valbuild/core/patch";
import { ParentRef, ValClient } from "@valbuild/shared/internal";
import { canMerge } from "./utils/mergePatches";
import { PatchSets, SerializedPatchSet } from "./utils/PatchSets";
import { ReifiedRender } from "@valbuild/core";

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
  /** serverSources is the state on the server, it is the actual state */
  private serverSources: Record<ModuleFilePath, JSONValue | undefined> | null;
  /** optimisticClientSources is the state of the client, optimistic means that patches have been applied in client-only */
  private optimisticClientSources: Record<
    ModuleFilePath,
    JSONValue | undefined
  >;
  private renders: Record<ModuleFilePath, ReifiedRender | null> | null;
  private schemas: Record<ModuleFilePath, SerializedSchema | undefined> | null;
  private serverSideSchemaSha: string | null;
  private clientSideSchemaSha: string | null;
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

  constructor(
    private readonly client: ValClient,
    private readonly overlayEmitter:
      | typeof defaultOverlayEmitter
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
    this.baseSha = null;
    this.sourcesSha = null;
    this.mode = null;
    this.optimisticClientSources = {};
    this.serverSources = null;
    this.renders = null;
    this.globalServerSidePatchIds = [];
    this.syncedServerSidePatchIds = [];
    this.savedButNotYetGlobalServerSidePatchIds = [];
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
    this.cachedSchemaSnapshots = null;
    this.cachedRenderSnapshots = null;
    this.cachedPatchData = null;
    this.cachedSerializedPatchSetsSnapshot = null;
    this.cachedValidationErrors = null;
    this.cachedAllSchemasSnapshot = null;
    this.cachedGlobalServerSidePatchIdsSnapshot = null;
    this.cachedPendingClientSidePatchIdsSnapshot = null;
    this.cachedSyncedServerSidePatchIdsSnapshot = null;
    this.cachedSavedServerSidePatchIdsSnapshot = null;
    this.cachedAllSourcesSnapshot = null;
    this.cachedSourcesSnapshot = null;
    this.cachedSyncStatus = null;
    this.cachedPendingOpsCountSnapshot = null;
    this.cachedInitializedAtSnapshot = null;
    this.cachedAutoPublishSnapshot = null;
    this.cachedPublishDisabledSnapshot = null;
    this.cachedGlobalTransientErrorSnapshot = null;
    this.cachedParentRef = undefined;
    this.cachedPatchErrorsSnapshot = null;
  }

  setAutoPublish(now: number, autoPublish: boolean) {
    this.autoPublish = autoPublish;
    try {
      localStorage.setItem("val-auto-publish", autoPublish.toString());
    } catch (err) {
      // ignore
    }
    this.invalidateAutoPublish();
    return this.sync(now);
  }

  private loadAutoPublish() {
    try {
      this.autoPublish = localStorage.getItem("val-auto-publish") === "true";
      this.invalidateAutoPublish();
    } catch (err) {
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
    this.sourcesSha = sourcesSha;
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
    this.sourcesSha = null;
    this.optimisticClientSources = {};
    this.serverSources = null;
    this.renders = null;
    this.globalServerSidePatchIds = [];
    this.syncedServerSidePatchIds = [];
    this.savedButNotYetGlobalServerSidePatchIds = [];
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
    this.cachedSchemaSnapshots = null;
    this.cachedRenderSnapshots = null;
    this.cachedPatchData = null;
    this.cachedSerializedPatchSetsSnapshot = null;
    this.cachedValidationErrors = null;
    this.cachedAllSchemasSnapshot = null;
    this.cachedGlobalServerSidePatchIdsSnapshot = null;
    this.cachedPendingClientSidePatchIdsSnapshot = null;
    this.cachedSyncedServerSidePatchIdsSnapshot = null;
    this.cachedSavedServerSidePatchIdsSnapshot = null;
    this.cachedAllSourcesSnapshot = null;
    this.cachedSyncStatus = null;
    this.cachedPendingOpsCountSnapshot = null;
    this.cachedInitializedAtSnapshot = null;
    this.cachedAutoPublishSnapshot = null;
    this.cachedPublishDisabledSnapshot = null;
    this.cachedGlobalTransientErrorSnapshot = null;
    this.cachedParentRef = undefined;
    this.cachedPatchErrorsSnapshot = null;

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
      this.cachedSourceSnapshots = {
        ...this.cachedSourceSnapshots,
        [moduleFilePath]: undefined,
      };
    }
    this.cachedAllSourcesSnapshot = null;
    this.cachedSourcesSnapshot = null;
    this.emit(this.listeners["sources"]?.[moduleFilePath]);
    this.emit(this.listeners["source"]?.[moduleFilePath]);
    this.emit(this.listeners["all-sources"]?.[globalNamespace]);
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
    this.emit(this.listeners["render"]?.[moduleFilePath]);
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

  private cachedSourceSnapshots: Record<
    ModuleFilePath,
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
  getSourceSnapshot(sourcePath: ModuleFilePath) {
    if (this.cachedSourceSnapshots === null) {
      this.cachedSourceSnapshots = {};
    }
    if (this.cachedSourceSnapshots[sourcePath] === undefined) {
      const moduleData =
        this.optimisticClientSources[sourcePath] !== undefined
          ? this.optimisticClientSources[sourcePath]
          : this.serverSources?.[sourcePath];

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
          optimistic: this.optimisticClientSources[sourcePath] !== undefined,
        };
      }
    }
    return this.cachedSourceSnapshots[sourcePath];
  }

  private cachedAllSourcesSnapshot: Record<ModuleFilePath, Json> | null;
  getAllSourcesSnapshot() {
    if (this.cachedAllSourcesSnapshot === null) {
      this.cachedAllSourcesSnapshot = {};
      for (const moduleFilePathS in this.schemas || {}) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        const data =
          this.optimisticClientSources[moduleFilePath] ||
          this.serverSources?.[moduleFilePath];
        if (data !== undefined) {
          this.cachedAllSourcesSnapshot[moduleFilePath] = deepClone(data);
        }
      }
    }
    return this.cachedAllSourcesSnapshot;
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
        const data =
          this.optimisticClientSources[moduleFilePath] ||
          this.serverSources?.[moduleFilePath];
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
      this.cachedValidationErrors = {};
      for (const sourcePathS in this.errors.validationErrors) {
        const sourcePath = sourcePathS as SourcePath;
        const newErrors = [];
        for (const error of this.errors.validationErrors[sourcePath] || []) {
          if (error) {
            newErrors.push(error);
          }
        }
        if (newErrors.length > 0) {
          this.cachedValidationErrors[sourcePath] = newErrors;
        }
      }
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
  private addPatchOnClientOnly(
    sourcePath: SourcePath | ModuleFilePath,
    patch: Patch,
    now: number,
  ):
    | {
        status: "optimistic-client-sources-updated";
        moduleFilePath: ModuleFilePath;
        prevSource: JSONValue;
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
      // This happens if the client add patches, but the server sources have not yet been initialized
      // so this should not happen
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
    if (this.optimisticClientSources[moduleFilePath] === undefined) {
      this.optimisticClientSources[moduleFilePath] =
        this.serverSources[moduleFilePath];
    }
    const patchableOps = patch.filter((op) => op.op !== "file");
    const patchRes = applyPatch(
      deepClone(this.optimisticClientSources[moduleFilePath] as JSONValue),
      ops,
      patchableOps,
    );
    if (result.isErr(patchRes)) {
      console.error("Could not apply patch:", patchRes.error);
      this.addGlobalTransientError(
        `Could apply patch: ${patchRes.error.message}`,
        now,
      );
      return {
        status: "patch-error",
        message: patchRes.error.message,
        moduleFilePath,
      };
    } else {
      const newSource = patchRes.value;
      const prevSource = deepClone(
        this.optimisticClientSources[moduleFilePath] as JSONValue,
      );
      this.optimisticClientSources[moduleFilePath] = newSource;
      return {
        status: "optimistic-client-sources-updated",
        moduleFilePath,
        prevSource,
        patch,
      } as const;
    }
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
    now: number,
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
    if (res.status !== "optimistic-client-sources-updated") {
      return res;
    }

    const { moduleFilePath, patch: addedPatch } = res;
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
    let opRes = await this.executeAddPatches(addOp, {}, now);
    while (opRes.status === "retry" && tries < 3) {
      tries++;
      await new Promise((resolve) => setTimeout(resolve, 500 * (tries + 1))); // wait 500ms, 1000ms, 1500ms
      opRes = await this.executeAddPatches(addOp, {}, now);
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
    // Reset optimistic state on failure
    this.optimisticClientSources[moduleFilePath] = res.prevSource;
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
    if (res.status !== "optimistic-client-sources-updated") {
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
        this.patchSetInsert(moduleFilePath, lastPatchId, patch, now);

        this.invalidateSyncStatus(sourcePath);
        this.invalidateSource(moduleFilePath);

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
        this.patchSetInsert(moduleFilePath, patchId, patch, now);

        this.invalidateSyncStatus(sourcePath);
        this.invalidateSource(moduleFilePath);

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
      this.patchSetInsert(moduleFilePath, patchId, patch, now);

      this.invalidateSyncStatus(sourcePath);
      this.invalidateSource(moduleFilePath);

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
    const sourcesShaDidChange = this.sourcesSha !== sourcesSha;
    this.sourcesSha = sourcesSha;
    this.baseSha = baseSha;
    this.mode = mode;
    if (
      this.serverSideSchemaSha !== schemaSha ||
      this.commitSha !== commitSha
    ) {
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
    const postPatchesBody: {
      path: ModuleFilePath;
      patch: Patch;
      patchId: PatchId;
    }[] = [];
    const newPatchIds: PatchId[] = [];
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
    const parentRef = this.getParentRef();
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
        this.patchDataByPatchId = {
          ...this.patchDataByPatchId,
          [patchId]: undefined,
        };
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
        }
      }
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
    }
    return {
      status: "done",
      syncAllRequired,
    };
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
        this.addGlobalTransientError(
          "Failed to get changes (full sync)",
          now,
          `Did not get ok status (got: ${res.status}): ${res.json.message}`,
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
            this.addGlobalTransientError(
              "Failed to get changes (batch)",
              now,
              `Did not get ok status (got: ${res.status}): ${res.json.message}`,
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
    if (this.clientSideSchemaSha !== this.serverSideSchemaSha) {
      // Schema has changed, so we need to sync everything
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
          } catch (err) {
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
          } catch (err) {
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
        const sourcesRes = await this.client("/sources/~", "PUT", {
          path: path,
          query: {
            validate_sources: true,
            validate_binary_files: false,
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
              this.serverSources[moduleFilePath] = valModule.source;
              if (this.renders === null) {
                this.renders = {};
              }
              this.renders[moduleFilePath] = valModule.render || null;
              this.invalidateRenders(moduleFilePath);

              if (
                // Feel free to revisit / rewrite this if statement:
                // We cannot remove optimisticClientSources, even if we just synced because the optimistic client side sources might have been changed while we were syncing
                // If we remove the optimistic client side sources without verifying that the server side sources are the same, the user will see a flash and it revert back to the previously saved state.
                // It feels like there might be errors that pops up because of this: what if the patch never is written / is wrong?! The change will then be lost.
                deepEqual(
                  this.serverSources[moduleFilePath] as ReadonlyJSONValue,
                  this.optimisticClientSources[
                    moduleFilePath
                  ] as ReadonlyJSONValue,
                ) ||
                // We check for pendingOps, because the check above will fail for files since they inject a patchId...
                this.pendingOps.length === 0
              ) {
                this.optimisticClientSources = {
                  ...this.optimisticClientSources,
                  [moduleFilePath]: undefined,
                };
              }
              console.debug("Invalidating source", moduleFilePath);
              // this.optimisticClientSources = {};
              // this.cachedDataSnapshots = {};
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
              // NOTE: we clean up relevant validation errors above
              for (const sourcePathS in valModule.validationErrors) {
                const sourcePath = sourcePathS as SourcePath;
                if (!this.errors.validationErrors) {
                  this.errors.validationErrors = {};
                }
                this.errors.validationErrors[sourcePath] =
                  valModule.validationErrors[sourcePath];
                changedValidationErrors.add(sourcePath);
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
        let hasValidationError = false;
        for (const sourcePathS in this.errors.validationErrors || {}) {
          const sourcePath = sourcePathS as SourcePath;
          if (
            this.errors?.validationErrors?.[sourcePath] &&
            this.errors?.validationErrors?.[sourcePath]!.length > 0
          ) {
            hasValidationError = true;
            break;
          }
        }
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
            this.errors.validationErrors,
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

      const hasValidationError =
        Object.values(this.errors.validationErrors || {}).flatMap(
          (errors) => errors || [],
        ).length > 0;
      if (hasValidationError) {
        console.debug(
          "Skipping publish since there's validation errors",
          this.errors.validationErrors,
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
        if (this.mode === "fs") {
          // In fs mode we delete all patch ids, so we start fresh
          this.globalServerSidePatchIds = [];
          console.debug("Deleting all patch ids");
        }
        this.pendingClientPatchIds = [];
        this.syncedServerSidePatchIds = [];
        this.savedButNotYetGlobalServerSidePatchIds = [];
        this.patchDataByPatchId = {};
        this.patchSets = new PatchSets();
        const fullReset = true;
        await this.syncPatches(fullReset, now);
        this.invalidatePatchSets();
        this.invalidateAllPatches();
        this.invalidatePendingClientSidePatchIds();
        this.invalidateSyncedServerSidePatchIds();
        this.invalidateSavedServerSidePatchIds();
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
  | "already-syncing";
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
  | "pending-ops-count"
  | "all-sources"
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
}>;
type DeletePatchesOp = CommonOpProps<{
  type: "delete-patches";
  patchIds: PatchId[];
}>;
type PendingOp = AddPatchOp | DeletePatchesOp;
