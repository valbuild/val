import {
  Internal,
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
} from "@valbuild/core/patch";
import { ParentRef, ValClient } from "@valbuild/shared/internal";
import { canMerge } from "./utils/mergePatches";
import { PatchSets, SerializedPatchSet } from "./utils/PatchSets";

/**
 * ValSyncStore is a store that keeps track of the state of the Val client.
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
 *  2) find a better model of the problem / cut down on the performance
 *
 * NOTE: we haven't actually measured the performance well, so one might argue that until we do that
 * we have no business in optimizing for performance. However, wrt performance the stance now is to,
 * for obviously common operations (writing text a string / richtext field),
 * we should to think a bit about what the minimum amount of work is required to safely get the job done (duh).
 * What we're trying to say is... ...That although optimizing performance is stupid without measuring,
 * it is even stupider to do lots of work that we simply know is unnecessary.
 */
export class ValSyncStore {
  initializedAt: number | null;
  /**
   * Patch Ids stored by this client
   */
  patchIdsStoredByClient: PatchId[];
  /**
   * Patch Ids reported by the /stat endpoint or webhook
   *
   * These are all the patch ids that are currently in the server; from this client AND FROM OTHER CLIENTS.
   **/
  globalServerSidePatchIds: PatchId[] | null;
  /**
   * Patch Ids created by this client, that are not yet stored
   */
  pendingClientPatchIds: PatchId[];
  patchDataByPatchId: Record<
    PatchId,
    {
      moduleFilePath: ModuleFilePath;
      patch: Patch;
      isPending: boolean;
      createdAt: string;
      authorId: string | null;
      isCommitted?: {
        committedAt: number;
      };
    }
  >;
  authorId: string | null;
  patchSets: PatchSets;
  /** serverSources is the state on the server, it is the actual state */
  serverSources: Record<ModuleFilePath, JSONValue> | null;
  /** optimisticClientSources is the state of the client, optimistic means that patches have been applied in client-only */
  optimisticClientSources: Record<ModuleFilePath, JSONValue>;
  schemas: Record<ModuleFilePath, SerializedSchema> | null;
  serverSideSchemaSha: string | null;
  clientSideSchemaSha: string | null;

  baseSha: string | null; // TODO: Currently not used, we should use this to reset the client state
  syncStatus: Record<SourcePath | ModuleFilePath, SyncStatus>;
  pendingOps: PendingOp[];
  errors: Partial<{
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
    validationErrors: Record<SourcePath, ValidationError[]>;
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
    this.pendingOps = [];
    this.patchIdsStoredByClient = [];
    this.pendingClientPatchIds = [];
    this.patchDataByPatchId = {};
    this.isSyncing = false;
    this.patchSets = new PatchSets();
    this.authorId = null;
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
    const res = await this.syncWithUpdatedStat(
      baseSha,
      schemaSha,
      patchIds,
      now,
    );
    if (res.status === "done") {
      this.initializedAt = now + (Date.now() - start);
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
    this.pendingOps = [];
    this.patchIdsStoredByClient = [];
    this.pendingClientPatchIds = [];
    this.patchDataByPatchId = {};
    this.isSyncing = false;
    this.patchSets = new PatchSets();
    this.authorId = null;
    for (const listenersOfType of Object.values(this.listeners)) {
      for (const listeners of Object.values(listenersOfType)) {
        this.emit(listeners);
      }
    }
  }

  // #region Subscribe
  private listeners: Partial<
    Record<SyncStoreListenerType, Record<string, (() => void)[]>>
  >;
  subscribe(
    type: "source",
    path: ModuleFilePath,
  ): (listener: () => void) => () => void;
  subscribe(
    type: "validation-error",
    path: SourcePath,
  ): (listener: () => void) => () => void;
  subscribe(
    type: "all-validation-errors",
  ): (listener: () => void) => () => void;
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
  subscribe(type: "schema"): (listener: () => void) => () => void;
  subscribe(type: "patch-sets"): (listener: () => void) => () => void;
  subscribe(
    type: SyncStoreListenerType,
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
  private invalidateSource(moduleFilePath: ModuleFilePath) {
    if (this.overlayEmitter && this.serverSources) {
      this.overlayEmitter(
        moduleFilePath,
        this.optimisticClientSources[moduleFilePath] ||
          this.serverSources[moduleFilePath],
      );
    }
    delete this.cachedDataSnapshots[moduleFilePath];
    this.emit(this.listeners.source?.[moduleFilePath]);
  }
  private invalidateSyncStatus(sourcePath: SourcePath | ModuleFilePath) {
    this.emit(this.listeners["sync-status"]?.[sourcePath]);
  }
  private invalidateValidationError(sourcePath: SourcePath) {
    this.emit(this.listeners["validation-error"]?.[sourcePath]);
  }
  private invalidateAllValidationErrors() {
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
  private invalidateSchema() {
    this.emit(this.listeners["schema"]?.[globalNamespace]);
    this.invalidateAllValidationErrors();
    for (const sourcePathS in this.listeners?.["validation-error"] || {}) {
      const sourcePath = sourcePathS as SourcePath;
      this.invalidateValidationError(sourcePath);
    }
  }

  // #region Snapshot
  getModuleData(sourcePath: SourcePath | ModuleFilePath) {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath as SourcePath);
    const isOptimistic =
      this.optimisticClientSources[moduleFilePath] !== undefined;
    const source =
      this.optimisticClientSources[moduleFilePath] !== undefined
        ? this.optimisticClientSources[moduleFilePath]
        : this.serverSources?.[moduleFilePath];

    if (source === undefined) {
      return {
        status: "module-source-not-found",
        moduleFilePath,
      } as const;
    }
    const schema = this.schemas?.[moduleFilePath];
    if (schema === undefined) {
      return {
        status: "module-schema-not-found",
        moduleFilePath,
      } as const;
    }
    if (!modulePath) {
      return {
        status: "success",
        optimistic: isOptimistic,
        data: {
          path: sourcePath,
          source: source,
          schema: schema,
        },
      } as const;
    }
    let dataAtPath;
    try {
      dataAtPath = Internal.resolvePath(modulePath, source, schema);
    } catch (err) {
      if (err instanceof Error) {
        return {
          status: "resolve-path-error",
          sourcePath,
          message: err.message,
        } as const;
      }
      return {
        status: "resolve-path-error",
        sourcePath,
        message: "Unknown error",
      } as const;
    }
    if (dataAtPath.source === undefined) {
      return {
        status: "resolved-source-not-found",
        sourcePath,
      } as const;
    }
    if (dataAtPath.schema === undefined) {
      return {
        status: "resolved-schema-not-found",
        sourcePath,
        message: "Schema not found",
      } as const;
    }
    if (dataAtPath.path === undefined) {
      return {
        status: "resolve-path-error-source-path-not-found",
        sourcePath,
      } as const;
    }
    return {
      status: "success",
      optimistic: isOptimistic,
      data: dataAtPath,
    } as const;
  }

  getServerSnapshot(sourcePath: SourcePath | ModuleFilePath) {
    return this.getModuleData(sourcePath);
  }

  private cachedDataSnapshots: Record<
    ModuleFilePath,
    Record<ModulePath, ReturnType<typeof this.getModuleData>>
  > = {};
  getDataSnapshot(sourcePath: SourcePath | ModuleFilePath) {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath as SourcePath);
    if (
      this.cachedDataSnapshots?.[moduleFilePath]?.[modulePath] === undefined
    ) {
      const snapshot = this.getModuleData(sourcePath);
      if (!this.cachedDataSnapshots[moduleFilePath]) {
        this.cachedDataSnapshots[moduleFilePath] = {};
      }
      this.cachedDataSnapshots[moduleFilePath][modulePath] = snapshot;
    }
    return this.cachedDataSnapshots[moduleFilePath][modulePath];
  }

  getValidationErrorSnapshot(sourcePath: SourcePath) {
    return this.errors.validationErrors?.[sourcePath];
  }
  getAllValidationErrorsSnapshot() {
    return this.errors.validationErrors;
  }

  getSyncStatusSnapshot(sourcePath: SourcePath) {
    return this.syncStatus[sourcePath];
  }
  private cachedSerializedPatchSetsSnapshot: SerializedPatchSet | null = null;
  getSerializedPatchSetsSnapshot() {
    if (!this.cachedSerializedPatchSetsSnapshot) {
      this.cachedSerializedPatchSetsSnapshot = this.patchSets.serialize();
    }
    return this.cachedSerializedPatchSetsSnapshot;
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
      this.invalidateSyncStatus(sourcePath);
      this.optimisticClientSources[moduleFilePath] = newSource;
      this.invalidateSource(moduleFilePath);
      if (lastOp?.type === "add-patches") {
        // Batch add-patches ops together to avoid too many requests...
        const lastPatchIdx = (lastOp.data[moduleFilePath]?.length || 0) - 1;
        const lastPatch = lastOp.data[moduleFilePath]?.[lastPatchIdx]?.patch;
        // ... either by merging them if possible (reduces amount of patch ops and data)
        if (
          canMerge(lastPatch, patch) &&
          // The type of the last should always be the same as long as the schema has not changed
          lastOp.data?.[moduleFilePath]?.[lastPatchIdx]?.type === type
        ) {
          lastOp.data[moduleFilePath][lastPatchIdx].patch = patch;
          lastOp.updatedAt = now;
          const patchId = lastOp.data[moduleFilePath][lastPatchIdx].patchId;
          this.patchDataByPatchId[patchId].patch = patch;
          this.patchSetInsert(moduleFilePath, patchId, patch, now);
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
          this.pendingClientPatchIds.push(patchId);
          this.patchDataByPatchId[patchId] = {
            moduleFilePath: moduleFilePath,
            patch: patch,
            isPending: true,
            createdAt: new Date(now).toISOString(),
            authorId: this.authorId,
          };
          this.patchSetInsert(moduleFilePath, patchId, patch, now);
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
        this.pendingClientPatchIds.push(patchId);
        this.patchDataByPatchId[patchId] = {
          moduleFilePath: moduleFilePath,
          patch: patch,
          isPending: true,
          createdAt: new Date(now).toISOString(),
          authorId: this.authorId,
        };
        this.patchSetInsert(moduleFilePath, patchId, patch, now);
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
    this.baseSha = baseSha;
    this.serverSideSchemaSha = schemaSha;
    const serverPatchIdsDidChange = !deepEqual(
      this.globalServerSidePatchIds?.concat(
        this.patchIdsStoredByClient || [],
      ) ?? null,
      patchIds,
    );
    this.globalServerSidePatchIds = patchIds;
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
    return this.sync(now, serverPatchIdsDidChange);
  }

  // #region Syncing
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
      console.log(
        "conflict parentref",
        parentRef && "patchId" in parentRef && parentRef.patchId,
      );
      // Try again if it is a conflict error:
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
        delete this.patchDataByPatchId[patchId];
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
          this.patchDataByPatchId[patchId].isPending = false;
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
          delete this.patchDataByPatchId[patchId];
        }
      }
      console.log(
        "stored   parentref",
        this.patchIdsStoredByClient[this.patchIdsStoredByClient.length - 1],
      );
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
            this.patchDataByPatchId[patchId].moduleFilePath;

          if (!changes[currentModuleFilePath]) {
            changes[currentModuleFilePath] = new Set();
          }
          changes[currentModuleFilePath].add("unknown");
          delete this.patchDataByPatchId[patchId];
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
        this.invalidateSchema();
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
    return {
      status: "retry",
      reason: "error",
    };
  }

  private async syncPatchSets(now: number): Promise<
    | {
        status: "done";
      }
    | {
        status: "retry";
      }
  > {
    // get missing data
    if (this.initializedAt === null) {
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
              this.patchDataByPatchId[patchData.patchId] = {
                moduleFilePath: patchData.path,
                patch: patchData.patch,
                isPending: false,
                createdAt: patchData.createdAt,
                authorId: patchData.authorId,
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
  async sync(
    now: number,
    serverPatchIdsDidChange: boolean,
  ): Promise<
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
      // #region Write operations:
      let op = this.pendingOps.shift(); // mutates pendingOps
      while (op) {
        if (op.type === "add-patches") {
          try {
            const res = await this.executeAddPatches(op, changes, now);
            if (res.status !== "done") {
              this.pendingOps.unshift(op);
              return res;
            }
          } catch (err) {
            this.pendingOps.unshift(op);
            return {
              status: "retry",
              reason: "error",
            };
          }
        } else if (op.type === "delete-patches") {
          try {
            const res = await this.executeDeletePatches(op, changes, now);
            if (res.status !== "done") {
              this.pendingOps.unshift(op);
              return res;
            } else {
              syncAllRequired = syncAllRequired || res.syncAllRequired;
            }
          } catch (err) {
            this.pendingOps.unshift(op);
            return {
              status: "retry",
              reason: "error",
            };
          }
        }
        op = this.pendingOps.shift();
      }

      // #region Read operations:
      if (this.clientSideSchemaSha === null || this.schemas === null) {
        const res = await this.syncSchema();
        if (res.status !== "done") {
          return res;
        }
      }
      const changedModules = this.getChangedModules(changes);
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
          // However, note that we are not quite sure how long it takes to evaluate 1 vs many...
          // NOTE currently we have only optimized for the case where
          // there's a lot of changes in a single text / richtext field that needs to be synced
          // (e.g. an editor is typing inside a richtext / text field)
          typeof changedModules === "object" && changedModules.length === 1
            ? (changedModules[0] as ModuleFilePath)
            : undefined;
        if (path === undefined) {
          console.log("GET SOURCES FROM", {
            //        this.initializedAt === null ||
            // this.clientSideSchemaSha !== this.serverSideSchemaSha ||
            // serverPatchIdsDidChange ||
            // syncAllRequired ||
            // changedModules === "all" ||
            // changedModules.length > 0
            path,
            initializedAt: this.initializedAt,
            changedModules,
            serverPatchIdsDidChange,
            syncAllRequired,
            schemaShaCompare:
              this.clientSideSchemaSha !== this.serverSideSchemaSha,
          });
        }
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
              delete this.errors.validationErrors[sourcePath];
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
                // We cannot remove optimisticClientSources, even if we just synced because the optimistic client side sources might have been changed while we were syncing
                // If we remove the optimistic client side sources without verifying that the server side sources are the same, the user will see a flash and it revert back to the previously saved state.
                // It feels like there might be errors that pops up because of this: what if the patch never is written / is wrong?! The change will then be lost.
                deepEqual(
                  this.serverSources[moduleFilePath],
                  this.optimisticClientSources[moduleFilePath],
                )
              ) {
                delete this.optimisticClientSources[moduleFilePath];
              }
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
          if (changedValidationErrors.size > 0) {
            this.invalidateAllValidationErrors();
          }
          for (const sourcePath of Array.from(changedValidationErrors)) {
            this.invalidateValidationError(sourcePath);
          }

          // Schema if it changed:
          if (sourcesRes.json.schemaSha !== this.clientSideSchemaSha) {
            await this.syncSchema();
          }
        }
      }
      await this.syncPatchSets(now);
      return {
        status: "done",
      };
    } finally {
      this.isSyncing = false;
    }
  }

  private addTransientGlobalError(
    message: string,
    now: number,
    details?: string,
  ) {
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

// #region Supporting code:
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

// #region Types:
type RetryReason =
  | "conflict"
  | "not-initialized"
  | "network-error"
  | "too-fast"
  | "error"
  | "already-syncing";
type SyncStoreListenerType =
  | "schema"
  | "sync-status"
  | "patch-sets"
  | "validation-error"
  | "all-validation-errors"
  | "transient-global-error"
  | "persistent-global-error"
  | "source";
type SyncStatus = "not-asked" | "fetching" | "patches-pending" | "done";
type WithTimestamp<T> = T & { createdAt: number; updatedAt?: number };
type AddPatchOp = WithTimestamp<{
  type: "add-patches";
  data: Record<
    ModuleFilePath,
    { patch: Patch; type: SerializedSchema["type"]; patchId: PatchId }[]
  >;
}>;
type DeletePatchesOp = WithTimestamp<{
  type: "delete-patches";
  patchIds: PatchId[];
}>;
type PendingOp = AddPatchOp | DeletePatchesOp;
