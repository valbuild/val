import {
  Internal,
  Json,
  ModuleFilePath,
  ModulePath,
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
   * Patch Ids stored by this client
   */
  private patchIdsStoredByClient: PatchId[];
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
   * Patch Ids that have been successfully been seen on server
   */
  private syncedPatchIds: Set<PatchId>;
  /**
   * Patch Ids that have been committed to the server
   */
  private committedPatchIds: Set<PatchId>;
  private publishDisabled: boolean;
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
  private schemas: Record<ModuleFilePath, SerializedSchema | undefined> | null;
  private serverSideSchemaSha: string | null;
  private clientSideSchemaSha: string | null;

  private baseSha: string | null; // TODO: Currently not used, we should use this to reset the client state
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
    transientGlobalErrorQueue: {
      message: string;
      timestamp: number;
      details?: string;
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
    validationErrors: Record<SourcePath, ValidationError[] | undefined>;
  }>;

  constructor(
    private readonly client: ValClient,
    private readonly overlayEmitter:
      | typeof defaultOverlayEmitter
      | undefined = undefined,
  ) {
    this.initializedAt = null;
    this.errors = {};
    this.listeners = {};
    this.syncStatus = {};
    this.schemas = null;
    this.serverSideSchemaSha = null;
    this.clientSideSchemaSha = null;
    this.baseSha = null;
    this.optimisticClientSources = {};
    this.serverSources = null;
    this.globalServerSidePatchIds = [];
    this.syncedPatchIds = new Set();
    this.committedPatchIds = new Set();
    this.pendingOps = [];
    this.patchIdsStoredByClient = [];
    this.pendingClientPatchIds = [];
    this.patchDataByPatchId = {};
    this.isSyncing = false;
    this.patchSets = new PatchSets();
    this.authorId = null;
    this.publishDisabled = true;
    //
    this.cachedSourceSnapshots = null;
    this.cachedSchemaSnapshots = null;
    this.cachedPatchData = null;
    this.cachedSerializedPatchSetsSnapshot = null;
    this.cachedValidationErrors = null;
    this.cachedAllSchemasSnapshot = null;
    this.cachedGlobalServerSidePatchIdsSnapshot = null;
    this.cachedAllSourcesSnapshot = null;
    this.cachedSyncStatus = null;
    this.cachedPendingOpsCountSnapshot = null;
    this.cachedInitializedAtSnapshot = null;
  }

  async init(
    baseSha: string,
    schemaSha: string,
    patchIds: PatchId[],
    authorId: string | null,
    now: number,
  ) {
    this.authorId = authorId;
    const start = Date.now();
    this.initializedAt = null;
    this.invalidateInitializedAt();
    const res = await this.syncWithUpdatedStat(
      baseSha,
      schemaSha,
      patchIds,
      now,
    );
    if (res.status === "done") {
      this.initializedAt = now + (Date.now() - start);
      this.invalidateInitializedAt();
    }
    return res;
  }

  reset() {
    this.initializedAt = null;
    this.errors = {};
    this.listeners = {};
    this.syncStatus = {};
    this.schemas = null;
    this.serverSideSchemaSha = null;
    this.clientSideSchemaSha = null;
    this.baseSha = null;
    this.optimisticClientSources = {};
    this.serverSources = null;
    this.globalServerSidePatchIds = [];
    this.syncedPatchIds = new Set();
    this.committedPatchIds = new Set();
    this.pendingOps = [];
    this.patchIdsStoredByClient = [];
    this.pendingClientPatchIds = [];
    this.patchDataByPatchId = {};
    this.isSyncing = false;
    this.patchSets = new PatchSets();
    this.authorId = null;
    this.publishDisabled = true;
    //
    this.cachedSourceSnapshots = null;
    this.cachedSchemaSnapshots = null;
    this.cachedPatchData = null;
    this.cachedSerializedPatchSetsSnapshot = null;
    this.cachedValidationErrors = null;
    this.cachedAllSchemasSnapshot = null;
    this.cachedGlobalServerSidePatchIdsSnapshot = null;
    this.cachedAllSourcesSnapshot = null;
    this.cachedSyncStatus = null;
    this.cachedPendingOpsCountSnapshot = null;
    this.cachedInitializedAtSnapshot = null;

    // TODO: ugly - we need to do this to make sure we get new references across the board
    for (const listenersOfType of Object.values(this.listeners)) {
      for (const listeners of Object.values(listenersOfType)) {
        this.emit(listeners);
      }
    }
  }

  // #region Subscribe
  private listeners: Partial<
    Record<SyncEngineListenerType, Record<string, (() => void)[]>>
  >;
  subscribe(
    type: "source",
    path: ModuleFilePath,
  ): (listener: () => void) => () => void;
  subscribe(type: "all-sources"): (listener: () => void) => () => void;
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
    type: "transient-global-error",
  ): (listener: () => void) => () => void;
  subscribe(
    type: "persistent-global-error",
  ): (listener: () => void) => () => void;
  subscribe(
    type: "global-server-side-patch-ids",
  ): (listener: () => void) => () => void;
  subscribe(type: "publish-disabled"): (listener: () => void) => () => void;
  subscribe(type: "schema"): (listener: () => void) => () => void;
  subscribe(type: "patch-sets"): (listener: () => void) => () => void;
  subscribe(type: "all-patches"): (listener: () => void) => () => void;
  subscribe(
    type: SyncEngineListenerType,
    path?: string,
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
      if (!listeners[type][p]) {
        listeners[type][p] = [];
      }
      const idx = listeners[type][p].push(listener) - 1;
      return () => {
        listeners[type]?.[p].splice(idx, 1);
      };
    };
  }
  private emit(listeners?: (() => void)[]) {
    if (listeners) {
      for (const listener of listeners) {
        listener();
      }
    }
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
    this.emit(this.listeners.source?.[moduleFilePath]);
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
  private invalidateTransientGlobalError() {
    this.emit(this.listeners["transient-global-error"]?.[globalNamespace]);
  }
  private invalidatePersistentGlobalError() {
    this.emit(this.listeners["persistent-global-error"]?.[globalNamespace]);
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
  private invalidateGlobalServerSidePatchIds() {
    this.cachedGlobalServerSidePatchIdsSnapshot = null;
    this.emit(
      this.listeners["global-server-side-patch-ids"]?.[globalNamespace],
    );
  }
  private invalidatePublishDisabled() {
    this.emit(this.listeners["publish-disabled"]?.[globalNamespace]);
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
        this.optimisticClientSources[sourcePath] ||
        this.serverSources?.[sourcePath];

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
        if (data) {
          this.cachedAllSourcesSnapshot[moduleFilePath] = deepClone(data);
        }
      }
    }
    return this.cachedAllSourcesSnapshot;
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
    return this.syncStatus[sourcePath];
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
          this.cachedPatchData[patchId] = patchData;
        }
      }
    }
    return this.cachedPatchData;
  }

  private cachedGlobalServerSidePatchIdsSnapshot: PatchId[] | null;
  getGlobalServerSidePatchIdsSnapshot() {
    if (
      this.cachedGlobalServerSidePatchIdsSnapshot === null &&
      this.globalServerSidePatchIds
    ) {
      this.cachedGlobalServerSidePatchIdsSnapshot =
        this.globalServerSidePatchIds.slice();
    }
    return this.cachedGlobalServerSidePatchIdsSnapshot;
  }

  getPublishDisabledSnapshot() {
    return this.publishDisabled;
  }

  // #region Patching
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
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(
      sourcePath as SourcePath,
    );
    const lastOp = this.pendingOps[this.pendingOps.length - 1];
    if (
      this.serverSources === null ||
      this.serverSources?.[moduleFilePath] === undefined
    ) {
      // This happens if the client add patches, but the server sources have not yet been initialized
      // so this should not happen
      this.addTransientGlobalError(
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
      this.addTransientGlobalError(
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
      this.syncStatus[sourcePath] = "patches-pending";
      this.optimisticClientSources[moduleFilePath] = newSource;
      // Try to batch add-patches ops together to avoid too many requests...
      if (lastOp?.type === "add-patches") {
        // ... either by merging them if possible (reduces amount of patch ops and data)
        const lastPatchIdx = (lastOp.data?.[moduleFilePath]?.length || 0) - 1;
        const lastPatch = lastOp.data?.[moduleFilePath]?.[lastPatchIdx]?.patch;
        const patchId = lastOp.data?.[moduleFilePath]?.[lastPatchIdx]?.patchId;
        if (
          canMerge(lastPatch, patch) &&
          // The type of the last should always be the same as long as the schema has not changed
          lastOp.data?.[moduleFilePath]?.[lastPatchIdx]?.type === type &&
          // If we do not have patchId nor patchData something is wrong and in this case we simply do not merge the patch
          patchId &&
          this.patchDataByPatchId[patchId]
        ) {
          lastOp.data[moduleFilePath][lastPatchIdx].patch = patch;
          lastOp.updatedAt = now;
          this.invalidatePendingOps();

          this.patchDataByPatchId[patchId]!.patch = patch;
          this.patchSetInsert(moduleFilePath, patchId, patch, now);

          this.invalidateSyncStatus(sourcePath);
          this.invalidateSource(moduleFilePath);
          return {
            status: "patch-merged",
            patchId: patchId,
            moduleFilePath,
          } as const;
        } else {
          // ... or by just pushing it to the last op
          if (!lastOp.data[moduleFilePath]) {
            lastOp.data[moduleFilePath] = [];
          }
          const patchId = crypto.randomUUID() as PatchId;
          lastOp.data[moduleFilePath].push({
            patch,
            type,
            patchId,
          });
          this.invalidatePendingOps();
          this.pendingClientPatchIds.push(patchId);
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
        const patchId = crypto.randomUUID() as PatchId;
        this.pendingOps.push({
          type: "add-patches",
          data: {
            [moduleFilePath]: [{ patch, type, patchId }],
          },
          createdAt: now,
        });
        this.invalidatePendingOps();
        this.pendingClientPatchIds.push(patchId);
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
    const patchId =
      this.patchIdsStoredByClient[this.patchIdsStoredByClient.length - 1] ||
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
    baseSha: string,
    schemaSha: string,
    patchIds: PatchId[],
    now: number,
  ) {
    if (this.baseSha !== baseSha) {
      this.baseSha = baseSha;
    }
    if (this.serverSideSchemaSha !== schemaSha) {
      this.serverSideSchemaSha = schemaSha;
    }
    if (!deepEqual(this.globalServerSidePatchIds, patchIds)) {
      // Do not update the globalServerSidePatchIds if they are the same
      // since we using this directly in get snapshot method
      this.globalServerSidePatchIds = patchIds;
      this.invalidateGlobalServerSidePatchIds();
      for (const patchId of patchIds) {
        for (let i = 0; i < this.pendingClientPatchIds.length; i++) {
          if (this.pendingClientPatchIds[i] === patchId) {
            this.pendingClientPatchIds.splice(i, 1);
            i--;
          }
        }
        for (let i = 0; i < this.patchIdsStoredByClient.length; i++) {
          if (this.patchIdsStoredByClient[i] === patchId) {
            this.patchIdsStoredByClient.splice(i, 1);
            i--;
          }
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
  ): Promise<
    | {
        status: "done";
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
      this.addTransientGlobalError(
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
    if (addPatchesRes.status === null) {
      console.warn("Network error: trying again...");
      this.addTransientGlobalError("Network error: trying again", now);
      // Try again if it is a network error:
      return {
        status: "retry",
        reason: "network-error",
      };
    } else if (addPatchesRes.status === 409) {
      // Try again if it is a conflict error (NOTE: this can absolutely happen if there are multiple concurrent users)
      return {
        status: "retry",
        reason: "conflict",
      };
    } else if (addPatchesRes.status !== 200) {
      console.error("Failed to add patches", {
        error: addPatchesRes.json.message,
      });
      this.addTransientGlobalError(
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
      for (let i = 0; i < this.pendingClientPatchIds.length; i++) {
        const patchId = this.pendingClientPatchIds[i];
        if (createdPatchIds.has(patchId)) {
          this.pendingClientPatchIds.splice(i, 1);
          i--;
        }
      }
      for (const patchIdS of newPatchIds) {
        const patchId = patchIdS as PatchId;
        if (createdPatchIds.has(patchId)) {
          this.patchIdsStoredByClient.push(patchId);
          if (this.patchDataByPatchId[patchId]) {
            this.patchDataByPatchId[patchId]!.isPending = false;
          }
        } else {
          console.error(
            `Failed to save changes: ${patchId} not found in createdPatchIds`,
            createdPatchIds,
          );
          this.addTransientGlobalError(
            `Failed to save some of the changes`,
            now,
            `Did not find expected patch id: '${patchId}'`,
          );
          this.patchDataByPatchId[patchId];
          this.patchDataByPatchId = {
            ...this.patchDataByPatchId,
            [patchId]: undefined,
          };
        }
      }
    }
    return {
      status: "done",
    };
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
    if (deleteRes.status === null) {
      this.addTransientGlobalError("Network error: trying again", now);
      return {
        status: "retry",
        reason: "network-error",
      };
    } else if (deleteRes.status !== 200) {
      // Give up unless it is a network error
      this.addTransientGlobalError("Failed to delete patches", now);
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
    // get missing data
    const isInit = this.initializedAt === null || reset;
    if (this.initializedAt === null || reset) {
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
        this.addTransientGlobalError(
          "Failed to get changes",
          now,
          res.json.message,
        );
        return {
          status: "retry",
        };
      }
      for (const patchData of res.json.patches) {
        if (patchData.patch) {
          if (patchData.appliedAt) {
            this.committedPatchIds.add(patchData.patchId);
          }
          this.patchDataByPatchId[patchData.patchId] = {
            moduleFilePath: patchData.path,
            patch: patchData.patch,
            isPending: false,
            createdAt: patchData.createdAt,
            authorId: patchData.authorId,
          };
        }
      }
      if (res.json.error) {
        this.addTransientGlobalError(
          "Some changes has errors",
          now,
          res.json.error.message,
        );
      }
      for (const error of Object.values(res.json.errors || {})) {
        if (error) {
          this.addTransientGlobalError(
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
            this.addTransientGlobalError(
              "Failed to get changes",
              now,
              res.json.message,
            );
            return {
              status: "retry",
            };
          }
          for (const patchData of res.json.patches) {
            if (patchData.patch) {
              if (patchData.appliedAt) {
                this.committedPatchIds.add(patchData.patchId);
              }
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

    let didUpdatePatchSet = false;
    const allCurrentPatchIds = new Set(this.globalServerSidePatchIds);
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
    for (const patchId of this.globalServerSidePatchIds || []) {
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
    this.invalidateAllPatches();
    if (didUpdatePatchSet) {
      this.invalidatePatchSets();
    }
    if (missingDataPatchIds.length > 0) {
      this.addTransientGlobalError(
        "Failed to get changes",
        now,
        `Missing data for patch ids: ${missingDataPatchIds.join(", ")}`,
      );
      return {
        status: "retry",
      };
    }
    // Init is complete:
    if (isInit) {
      this.publishDisabled = false;
      this.invalidatePublishDisabled();
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
  public isSyncing = false;
  private MIN_WAIT_SECONDS = 1;
  private MAX_WAIT_SECONDS = 5;

  // #region Sync
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
    this.isSyncing = true;
    let pendingOps: PendingOp[] = [];
    let serverPatchIdsDidChange = false;
    for (const patchId of this.globalServerSidePatchIds || []) {
      if (
        !this.syncedPatchIds.has(patchId) &&
        !this.committedPatchIds.has(patchId)
      ) {
        serverPatchIdsDidChange = true;
      }
    }
    // This will happen if there's patches that are removed
    for (const patchId of this.syncedPatchIds) {
      if (
        this.globalServerSidePatchIds &&
        !this.globalServerSidePatchIds.includes(patchId)
      ) {
        this.reset();
        console.log("Resetting ValSyncEngine");
        return {
          status: "retry",
          reason: "patch-ids-changed",
        };
      }
    }

    try {
      let syncAllRequired = false;
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
              syncAllRequired = syncAllRequired || res.syncAllRequired;
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
      const changedModules = this.getChangedModules(changes);
      // console.log("Syncing?", {
      //   initializedAt: this.initializedAt,
      //   schemaShaDiff: this.clientSideSchemaSha !== this.serverSideSchemaSha,
      //   syncAllRequired,
      //   changedModules,
      // });
      if (
        // TODO: clean this up, surely there's no need for 4 different ways of triggering sources sync
        this.initializedAt === null ||
        this.clientSideSchemaSha !== this.serverSideSchemaSha ||
        serverPatchIdsDidChange ||
        syncAllRequired ||
        changedModules === "all" ||
        changedModules.length > 0
      ) {
        const path =
          // We could be smarter wrt to the modules we fetch.
          // However, note¨ that we are not quite sure how long it takes to evaluate 1 vs many...
          // NOTE currently we have only optimized for the case where
          // there's a lot of changes in a single text / richtext field that needs to be synced
          // (e.g. an editor is typing inside a richtext / text field)
          this.initializedAt !== null &&
          typeof changedModules === "object" &&
          changedModules.length === 1
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
        if (sourcesRes.status === null) {
          this.addTransientGlobalError("Network error: trying again", now);
          return {
            status: "retry",
            reason: "network-error",
          };
        } else if (sourcesRes.status !== 200) {
          this.addTransientGlobalError(
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
                this.syncedPatchIds.add(syncedPatchId);
              }
              for (const syncedPatchId of valModule.patches?.skipped || []) {
                this.syncedPatchIds.add(syncedPatchId);
              }
            } else {
              this.addTransientGlobalError(
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
      await this.syncPatches(false, now);
      if (changedModules)
        if (this.overlayEmitter) {
          if (didWrite && this.serverSources) {
            for (const moduleFilePathS in changes) {
              const moduleFilePath = moduleFilePathS as ModuleFilePath;
              const source =
                this.optimisticClientSources[moduleFilePath] ||
                this.serverSources[moduleFilePath];
              if (source) {
                this.overlayEmitter(moduleFilePath, source);
              }
            }
          } else if (
            (this.initializedAt === null || serverPatchIdsDidChange) &&
            this.serverSources
          ) {
            // Initialize overlay
            for (const moduleFilePathS in this.schemas) {
              const moduleFilePath = moduleFilePathS as ModuleFilePath;
              const source =
                this.optimisticClientSources[moduleFilePath] ||
                this.serverSources[moduleFilePath];
              if (source) {
                this.overlayEmitter(moduleFilePath, source);
              }
            }
          }
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
      this.publishDisabled = true;
      this.invalidatePublishDisabled();
      if (patchIds.length === 0) {
        this.addTransientGlobalError(
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
        this.addTransientGlobalError(
          "Network error: could not publish",
          Date.now(),
        );
        return {
          status: "retry",
        } as const;
      } else if (res.status !== 200) {
        this.addTransientGlobalError(
          "Failed to publish changes",
          Date.now(),
          res.json.message,
        );
        return {
          status: "retry",
        } as const;
      } else {
        this.reset();
        console.log("Publish success", await this.sync(now));
        return {
          status: "done",
        } as const;
      }
    } finally {
      this.publishDisabled = false;
      this.invalidatePublishDisabled();
    }
  }

  addTransientGlobalError(message: string, now: number, details?: string) {
    if (!this.errors.transientGlobalErrorQueue) {
      this.errors.transientGlobalErrorQueue = [];
    }
    this.errors.transientGlobalErrorQueue.push({
      message,
      details,
      timestamp: now,
    });
    this.invalidateTransientGlobalError();
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
  | "error"
  | "patch-ids-changed"
  | "already-syncing";
type SyncEngineListenerType =
  | "schema"
  | "initialized-at"
  | "sync-status"
  | "patch-sets"
  | "all-patches"
  | "validation-error"
  | "all-validation-errors"
  | "transient-global-error"
  | "persistent-global-error"
  | "global-server-side-patch-ids"
  | "publish-disabled"
  | "pending-ops-count"
  | "all-sources"
  | "source";
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
