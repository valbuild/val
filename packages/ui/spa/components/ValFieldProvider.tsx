import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  DEFAULT_APP_HOST,
  DEFAULT_VAL_REMOTE_HOST,
  FILE_REF_PROP,
  Internal,
  Json,
  ModuleFilePath,
  ModuleFilePathSep,
  ModulePath,
  PatchId,
  ReifiedRender,
  SerializedSchema,
  SourcePath,
  ValConfig,
} from "@valbuild/core";
import { useValSystem } from "../stores/react/SystemContext";
import type { UploadProgress } from "../stores/PatchStore";
import { Patch } from "@valbuild/core/patch";
import { isJsonArray } from "../utils/isJsonArray";
import { JsonEntriesProgress, ValSyncEngine } from "../ValSyncEngine";
import { getNavPathFromAll } from "./getNavPath";

// --- Source override context ---
// When rendering the "before" side of a diff, the parent `Field` component
// provides the full module-level server source via this context so that all
// descendant hooks read from it instead of the engine's optimistic source.

type SourceOverride = {
  moduleFilePath: ModuleFilePath;
  moduleSource: Json;
};

const FieldSourceOverrideContext = React.createContext<SourceOverride | null>(
  null,
);

export { FieldSourceOverrideContext };
export type { SourceOverride };

type ValFieldContextValue = {
  syncEngine: ValSyncEngine;
  getDirectFileUploadSettings: () => Promise<
    | {
        status: "success";
        data: {
          nonce: string | null;
          baseUrl: string;
          contentBaseUrl: string | null;
          contentAuthNonce: string | null;
        };
      }
    | {
        status: "error";
        error: string;
      }
  >;
  config: ValConfig | undefined;
};

const ValFieldContext = React.createContext<ValFieldContextValue | null>(null);

function useValFieldContext(): ValFieldContextValue {
  const ctx = useContext(ValFieldContext);
  if (!ctx) {
    throw new Error("Cannot use ValFieldContext outside of ValFieldProvider");
  }
  return ctx;
}

export function useIsInsideValFieldProvider(): boolean {
  return useContext(ValFieldContext) !== null;
}

export function ValFieldProvider({
  children,
  syncEngine,
  getDirectFileUploadSettings,
  config,
}: {
  children: React.ReactNode;
  syncEngine: ValSyncEngine;
  getDirectFileUploadSettings: () => Promise<
    | {
        status: "success";
        data: {
          nonce: string | null;
          baseUrl: string;
          contentBaseUrl: string | null;
          contentAuthNonce: string | null;
        };
      }
    | {
        status: "error";
        error: string;
      }
  >;
  config: ValConfig | undefined;
}) {
  return (
    <ValFieldContext.Provider
      value={{
        syncEngine,
        getDirectFileUploadSettings,
        config,
      }}
    >
      {children}
    </ValFieldContext.Provider>
  );
}

const useSyncEngineInitializedAt = (syncEngine: ValSyncEngine) => {
  const initializedAt = useSyncExternalStore(
    syncEngine.subscribe("initialized-at"),
    () => syncEngine.getInitializedAtSnapshot(),
    () => syncEngine.getInitializedAtSnapshot(),
  );
  return initializedAt.data;
};

export function useSyncEngine(): ValSyncEngine {
  return useValFieldContext().syncEngine;
}

export type LoadingStatus = "loading" | "not-asked" | "error" | "success";
export function useLoadingStatus(): LoadingStatus {
  const { syncEngine } = useValFieldContext();
  const pendingOpsCount = useSyncExternalStore(
    syncEngine.subscribe("pending-ops-count"),
    () => syncEngine.getPendingOpsSnapshot(),
    () => syncEngine.getPendingOpsSnapshot(),
  );
  if (pendingOpsCount > 0) {
    return "loading";
  }
  return "success";
}

// Module-scoped monotonic counter; useRef captures the value once per mount,
// so each component instance gets a unique stable id for its lifetime.
let creatorIdCounter = 0;
export function useFieldCreatorId(): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) {
    ref.current = `c${++creatorIdCounter}`;
  }
  return ref.current;
}

export function useAddPatch(
  sourcePath: SourcePath | ModuleFilePath,
  creatorId?: string,
) {
  const { syncEngine } = useValFieldContext();
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const patchPath = useMemo(() => {
    return Internal.createPatchPath(modulePath);
  }, [modulePath]);
  /**
   * Write through the STORE, then apply the same patch locally in the engine.
   *
   * This is the single choke point for field writes — `addPatch`,
   * `addPatchAwaitable` and `addModuleFilePatch` all come here — which is why the
   * flip is one function rather than twenty call sites.
   *
   * ## Why this direction
   *
   * It used to be the other way: the engine wrote and the store mirrored. That
   * stopped working the moment `/stat` was wired into the store system, and the
   * reason is about patch IDENTITY. The engine MERGES consecutive keystrokes into
   * one patch; the store creates one per edit. So the engine's chain held one id
   * where the store's held six, and when stat announced the engine's id the store
   * did not recognise it, fetched it, and applied the same edit twice — harmless
   * for a `replace`, wrong for an array `add`.
   *
   * Only one system can mint ids, and it has to be the one that writes. So: the
   * store creates the patch, which mints the id and issues the `PUT`, and the id
   * is then handed to the engine so every component still reading from the engine
   * sees the edit. One id per edit, one writer, and stat announces ids the store
   * already has.
   *
   * ## What a caller sees when it fails
   *
   * The store's `createPatch` can genuinely fail before a patch exists — an upload
   * can fail — and that is now the real outcome of a write rather than something
   * happening in a mirror. So a failure is NOT swallowed: nothing is applied
   * locally either, because applying an edit the server will never have is how a
   * user comes to trust a value that does not exist.
   */
  const valSystem = useValSystem();
  const writePatch = useCallback(
    async (
      target: ModuleFilePath,
      patch: Patch,
      onProgress?: UploadProgress,
    ): Promise<
      { status: "ok"; patchId: PatchId } | { status: "error"; message: string }
    > => {
      if (valSystem === null) {
        // No store system: nothing can be written. Said out loud rather than
        // dropped silently — this path exists only for a Studio rendered outside
        // `ValStoreShadow`, which will not exist once the engine is removed.
        return {
          status: "error",
          message:
            "Cannot write: no store system is mounted. The edit was dropped.",
        };
      }
      // The id is minted FIRST, so both systems use one identity and neither has
      // to wait for the other.
      const patchId = valSystem.system.patchStore.mintPatchId();
      // Does this patch carry bytes? It decides the ORDER, and the order matters
      // for exactly one reason.
      const carriesFiles = patch.some((op) => op.op === "file");

      if (!carriesFiles) {
        // Apply locally NOW, synchronously, before the write. A plain patch has
        // nothing to upload, so the only way the store can fail is a bug — and
        // making the character wait for a promise before it appears is a lag the
        // user feels. The engine's source moves in the same tick as the keystroke,
        // exactly as it did before writes moved.
        const applied = syncEngine.applyPatchLocally(
          target,
          patch,
          patchId,
          Date.now(),
          creatorId,
        );
        if (applied.status !== "applied") {
          return { status: "error", message: applied.message };
        }
        const res = await valSystem.system.patchStore.createPatch(
          target,
          patch,
          undefined,
          creatorId,
          onProgress,
          patchId,
        );
        if (res.status !== "created") {
          return { status: "error", message: res.message };
        }
        return { status: "ok", patchId };
      }

      // With bytes, the store goes first and is awaited. Applying before the
      // upload lands would show a value pointing at a file that does not exist —
      // which is the failure `PatchStore.createPatch`'s upload-then-record
      // ordering exists to prevent, and it would be reintroduced here for the
      // sake of a responsiveness nobody needs: an image upload is not a keystroke.
      const res = await valSystem.system.patchStore.createPatch(
        target,
        patch,
        undefined,
        creatorId,
        onProgress,
        patchId,
      );
      if (res.status !== "created") {
        return { status: "error", message: res.message };
      }
      const applied = syncEngine.applyPatchLocally(
        target,
        patch,
        patchId,
        Date.now(),
        creatorId,
      );
      if (applied.status !== "applied") {
        return { status: "error", message: applied.message };
      }
      return { status: "ok", patchId };
    },
    [valSystem, syncEngine, creatorId],
  );

  const addPatch = useCallback(
    (patch: Patch, type: SerializedSchema["type"]) => {
      // `type` existed so the engine could decide whether two consecutive patches
      // were mergeable. Nothing merges any more — the store creates one patch per
      // edit — so it is unused. Kept in the signature because ~30 call sites pass
      // it, and changing them all is noise in a diff about who writes.
      void type;
      void writePatch(moduleFilePath, patch).then((res) => {
        if (res.status === "error") {
          console.error("Val: could not write patch", res.message);
        }
      });
    },
    [moduleFilePath, writePatch],
  );
  const addModuleFilePatch = useCallback(
    (
      moduleFilePath: ModuleFilePath,
      patch: Patch,
      type: SerializedSchema["type"],
    ) => {
      void type;
      void writePatch(moduleFilePath, patch);
    },
    [writePatch],
  );

  /**
   * The direct file upload used to live here: split the patch, POST each file's
   * bytes under an id this hook minted, then send the hashed ops.
   *
   * It is gone because the store system owns writes, and therefore owns patch
   * ids: bytes uploaded under an id chosen here would be attached to a patch that
   * never exists. The same protocol now lives in `createValSystem`'s `uploadFile`
   * seam, still on `XMLHttpRequest` so upload progress is still reported, and
   * `PatchStore.createPatch` does the ordering — upload, then record, and roll the
   * uploads back if any of them fails so nothing references a file that is not
   * there.
   */
  const addAndUploadPatchWithFileOps = useCallback(
    async (
      patch: Patch,
      type: "image" | "file",
      onError: (message: string) => void,
      onProgress: (
        bytesUploaded: number,
        totalBytes: number,
        currentFile: number,
        totalFiles: number,
      ) => void,
    ) => {
      // Handed to the store WHOLE, file ops included.
      //
      // This function used to split the patch itself, upload each file under an
      // id it minted, and then send the hashed ops. It cannot any more, and the
      // reason is the flip: the store mints patch ids now, because the store is
      // what writes. Files uploaded under an id chosen here would be attached to
      // a patch that never exists.
      //
      // Handing the whole patch over is also strictly better ordering than what
      // this did. `PatchStore.createPatch` uploads the bytes, then records the
      // patch, then runs deletes — and if an upload fails it rolls back the ones
      // that landed and creates no patch at all, so nothing ever references a
      // file that is not there. `splitPatchFileOps` still does the splitting; it
      // just does it inside the store, where the ordering rule lives.
      const res = await writePatch(moduleFilePath, patch, onProgress);
      if (res.status === "error") {
        onError(res.message);
        return;
      }
    },
    [moduleFilePath, writePatch],
  );
  return {
    patchPath,
    addPatch,
    addAndUploadPatchWithFileOps,
    addModuleFilePatch,
  };
}

export function useGetDirectFileUploadSettings() {
  return useValFieldContext().getDirectFileUploadSettings;
}

export function useValConfig() {
  // Tolerate being rendered without a ValFieldProvider (e.g. in Storybook).
  // Config is already typed as optional throughout — returning undefined here
  // is consistent with that contract.
  const ctx = useContext(ValFieldContext);
  const config = ctx?.config;
  const lastConfig = useRef<
    | (ValConfig & {
        remoteHost: string;
        appHost: string;
        studioPrefix: string;
      })
    | undefined
  >(
    config && {
      ...config,
      remoteHost: DEFAULT_VAL_REMOTE_HOST,
      appHost: DEFAULT_APP_HOST,
      studioPrefix: "/val/~",
    },
  );
  useEffect(() => {
    if (config) {
      lastConfig.current = {
        ...config,
        remoteHost: DEFAULT_VAL_REMOTE_HOST,
        appHost: DEFAULT_APP_HOST,
        studioPrefix: "/val/~",
      };
    }
  }, [config]);
  return lastConfig.current;
}

/** `undefined` when the module has nothing to render at this path. */
type RenderOverrideAtPathResult = ReifiedRender[SourcePath] | undefined;

export function useRenderOverrideAtPath(
  sourcePath: SourcePath | ModuleFilePath,
): RenderOverrideAtPathResult {
  const { syncEngine } = useValFieldContext();
  const [moduleFilePath] = useMemo(() => {
    return Internal.splitModuleFilePathAndModulePath(sourcePath);
  }, [sourcePath]);
  const renderRes = useSyncExternalStore(
    syncEngine.subscribe("render", moduleFilePath),
    () => syncEngine.getRenderSnapshot(moduleFilePath),
    () => syncEngine.getRenderSnapshot(moduleFilePath),
  );
  const sourcesRes = useSyncExternalStore(
    syncEngine.subscribe("source", moduleFilePath),
    () => syncEngine.getSourceSnapshot(moduleFilePath),
    () => syncEngine.getSourceSnapshot(moduleFilePath),
  );
  const initializedAt = useSyncEngineInitializedAt(syncEngine);
  return useMemo<RenderOverrideAtPathResult>(() => {
    const isOptimistic =
      sourcesRes.status === "success" &&
      syncEngine.isOptimisticFor(moduleFilePath);
    const renderAtPath = renderRes?.[sourcePath];
    if (initializedAt === null || isOptimistic) {
      const renderData =
        renderAtPath && "data" in renderAtPath ? renderAtPath?.data : undefined;
      return { status: "loading", data: renderData };
    }
    return renderAtPath;
  }, [
    renderRes,
    initializedAt,
    sourcesRes,
    sourcePath,
    syncEngine,
    moduleFilePath,
  ]);
}

type SchemaAtPathResult =
  | { status: "not-found" }
  | { status: "loading" }
  | { status: "success"; data: SerializedSchema }
  | { status: "error"; error: string };

type SchemaWithResolvedPathResult =
  | { status: "not-found" }
  | { status: "loading" }
  | { status: "success"; data: SerializedSchema; resolvedPath: SourcePath }
  | { status: "error"; error: string };

/**
 * Everything resolving a path against the module's schema and source can come
 * back with — including the sync engine's own snapshot statuses, which are
 * returned as-is. {@link useSchemaAtPathInternal} narrows this down to the four
 * states of {@link SchemaWithResolvedPathResult} that a field renders.
 */
type ResolvedSchemaAtPathResult =
  | { status: "loading" }
  | {
      status:
        | "no-schemas"
        | "module-schema-not-found"
        | "schema-not-found"
        | "source-not-found"
        | "resolved-schema-not-found";
      message?: string;
    }
  | { status: "error"; error: string }
  | { status: "success"; data: SerializedSchema; resolvedPath: SourcePath };

function useSchemaAtPathInternal(
  sourcePath: SourcePath | ModuleFilePath,
): SchemaWithResolvedPathResult {
  const { syncEngine } = useValFieldContext();
  const sourceOverride = useContext(FieldSourceOverrideContext);
  const [moduleFilePath, modulePath] = useMemo(() => {
    return Internal.splitModuleFilePathAndModulePath(sourcePath);
  }, [sourcePath]);
  const schemaRes = useSyncExternalStore(
    syncEngine.subscribe("schema"),
    () => syncEngine.getSchemaSnapshot(moduleFilePath),
    () => syncEngine.getSchemaSnapshot(moduleFilePath),
  );
  const sourcesRes = useSyncExternalStore(
    syncEngine.subscribe("source", moduleFilePath),
    () => syncEngine.getSourceSnapshot(moduleFilePath),
    () => syncEngine.getSourceSnapshot(moduleFilePath),
  );
  const sourceData = useMemo(
    () =>
      sourceOverride && sourceOverride.moduleFilePath === moduleFilePath
        ? sourceOverride.moduleSource
        : sourcesRes.status === "success"
          ? sourcesRes.data
          : undefined,
    [sourceOverride, moduleFilePath, sourcesRes],
  );
  // Lazily load `.jsonValues()` entry content when the path descends into an
  // un-loaded marker, and treat the schema as loading until it resolves.
  const unloadedJsonKey = useMemo(
    () => findUnloadedJsonEntryKey(modulePath, sourceData),
    [modulePath, sourceData],
  );
  useEffect(() => {
    if (unloadedJsonKey !== null) {
      syncEngine.requestJsonEntry(moduleFilePath, unloadedJsonKey);
    }
  }, [syncEngine, moduleFilePath, unloadedJsonKey]);
  const jsonEntryError = useSyncExternalStore(
    syncEngine.subscribe("source", moduleFilePath),
    () =>
      unloadedJsonKey === null
        ? null
        : syncEngine.getJsonEntryError(moduleFilePath, unloadedJsonKey),
    () =>
      unloadedJsonKey === null
        ? null
        : syncEngine.getJsonEntryError(moduleFilePath, unloadedJsonKey),
  );
  const resolvedSchemaAtPathRes = useMemo<ResolvedSchemaAtPathResult>(() => {
    if (schemaRes.status !== "success") {
      return schemaRes;
    }
    if (unloadedJsonKey !== null) {
      // A failed load must not render as a perpetual spinner.
      if (jsonEntryError !== null) {
        return {
          status: "error",
          error: `Could not load entry '${unloadedJsonKey}': ${jsonEntryError}`,
        };
      }
      return { status: "loading" };
    }
    if (sourceData === undefined) {
      if (sourcesRes.status !== "success") {
        return sourcesRes;
      }
      return { status: "source-not-found" };
    }

    try {
      const resolvedSchemaAtPathRes = Internal.safeResolvePath(
        modulePath,
        sourceData,
        schemaRes.data,
      );
      if (resolvedSchemaAtPathRes.status === "error") {
        return {
          status: "error",
          error: resolvedSchemaAtPathRes.message,
        };
      }
      if (resolvedSchemaAtPathRes.status === "source-undefined") {
        return {
          status: "source-not-found",
        };
      }
      if (!resolvedSchemaAtPathRes.schema) {
        return {
          status: "resolved-schema-not-found",
        };
      }
      const resolvedModulePath =
        resolvedSchemaAtPathRes.path as unknown as ModulePath;
      const resolvedSourcePath = resolvedModulePath
        ? Internal.joinModuleFilePathAndModulePath(
            moduleFilePath,
            resolvedModulePath,
          )
        : (moduleFilePath as unknown as SourcePath);
      return {
        status: "success",
        data: resolvedSchemaAtPathRes.schema,
        resolvedPath: resolvedSourcePath,
      };
    } catch (e) {
      console.error(
        "Error resolving schema at path",
        sourcePath,
        modulePath,
        sourceData,
        schemaRes.data,
        e,
      );
      return {
        status: "error",
        error: `Error resolving schema at path: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }, [
    schemaRes,
    sourcesRes,
    moduleFilePath,
    modulePath,
    sourceData,
    unloadedJsonKey,
    jsonEntryError,
  ]);
  const initializedAt = useSyncEngineInitializedAt(syncEngine);
  if (initializedAt === null) {
    return { status: "loading" };
  }
  if (resolvedSchemaAtPathRes.status !== "success") {
    if (resolvedSchemaAtPathRes.status === "resolved-schema-not-found") {
      return { status: "not-found" };
    }
    if (resolvedSchemaAtPathRes.status === "source-not-found") {
      return { status: "not-found" };
    }
    if (resolvedSchemaAtPathRes.status === "no-schemas") {
      return { status: "error", error: "No schemas" };
    }
    if (resolvedSchemaAtPathRes.status === "module-schema-not-found") {
      return { status: "not-found" };
    }
    // The source snapshot's own "the module has no schema" — same answer as
    // module-schema-not-found, and without this it fell through to "loading"
    // and span forever.
    if (resolvedSchemaAtPathRes.status === "schema-not-found") {
      return { status: "not-found" };
    }
    if (resolvedSchemaAtPathRes.status === "error") {
      return { status: "error", error: resolvedSchemaAtPathRes.error };
    }
    return {
      status: "loading",
    };
  }
  return resolvedSchemaAtPathRes;
}

export function useSchemaAtPath(
  sourcePath: SourcePath | ModuleFilePath,
): SchemaAtPathResult {
  const res = useSchemaAtPathInternal(sourcePath);
  if (res.status === "success") {
    return { status: "success", data: res.data };
  }
  return res;
}

/**
 * Like {@link useSchemaAtPath} but also returns the effective source path
 * that the schema resolved to. For most schema types, this equals the input
 * path. For leaf schemas like `image` / `file` that absorb sub-paths
 * (e.g. `metadata.hotspot`), the resolved path is truncated to the
 * schema boundary.
 */
export function useSchemaWithResolvedPath(
  sourcePath: SourcePath | ModuleFilePath,
): SchemaWithResolvedPathResult {
  return useSchemaAtPathInternal(sourcePath);
}

export function useSchemas():
  | {
      status: "loading";
    }
  | {
      status: "error";
      error: "Schemas not found";
    }
  | {
      status: "success";
      data: Record<ModuleFilePath, SerializedSchema>;
    } {
  const { syncEngine } = useValFieldContext();
  const schemas = useSyncExternalStore(
    syncEngine.subscribe("schema"),
    () => syncEngine.getAllSchemasSnapshot(),
    () => syncEngine.getAllSchemasSnapshot(),
  );

  const initializedAt = useSyncEngineInitializedAt(syncEngine);
  if (initializedAt === null) {
    return { status: "loading" };
  }
  if (schemas === null) {
    console.warn("Schemas: not found");
    return {
      status: "error",
      error: "Schemas not found",
    };
  }
  const definedSchemas: Record<ModuleFilePath, SerializedSchema> = {};
  for (const [moduleFilePathS, moduleSchema] of Object.entries(schemas)) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    if (moduleSchema) {
      definedSchemas[moduleFilePath] = moduleSchema;
    }
  }
  return {
    status: "success",
    data: definedSchemas,
  };
}

export function useAllSources() {
  const { syncEngine } = useValFieldContext();
  const sources = useSyncExternalStore(
    syncEngine.subscribe("all-sources"),
    () => syncEngine.getAllSourcesSnapshot(),
    () => syncEngine.getAllSourcesSnapshot(),
  );
  return sources;
}

/**
 * Resolves a navigation path, reading every module's source and schema ON DEMAND
 * rather than subscribing to them.
 *
 * Use this - never `useAllSources()` + `useSchemas()` - whenever the data is only
 * ever read inside an event handler.
 *
 * `getAllSourcesSnapshot()` walks every module and `deepClone`s each one, and
 * `invalidateSource` drops its cache on every keystroke, so the snapshot is a new
 * object every time. A component that subscribes to it therefore re-renders, and
 * forces a fresh deep clone of the WHOLE project, on every keystroke anywhere in
 * the Studio. `Field` wraps every leaf field, so subscribing there made a single
 * keystroke O(project size) - for data that only a click handler ever looked at.
 */
export function useGetNavPath(): (
  path: SourcePath | ModuleFilePath,
) => SourcePath | ModuleFilePath | null {
  const { syncEngine } = useValFieldContext();
  return useCallback(
    (path: SourcePath | ModuleFilePath) =>
      getNavPathFromAll(
        path,
        syncEngine.getAllSourcesSnapshot(),
        syncEngine.getAllSchemasSnapshot() ?? undefined,
      ),
    [syncEngine],
  );
}

/**
 * Progress of the current `.jsonValues()` entry load run — spans every module in
 * flight, so a percentage does not reset at module boundaries. NOTE: `percentage`
 * is 100 while `status` is `"idle"`, so check the status before showing it.
 */
export function useJsonEntriesProgress(): JsonEntriesProgress {
  const { syncEngine } = useValFieldContext();
  return useSyncExternalStore(
    syncEngine.subscribe("json-entries-progress"),
    () => syncEngine.getJsonEntriesProgressSnapshot(),
    () => syncEngine.getJsonEntriesProgressSnapshot(),
  );
}

export function useAllRenders() {
  const { syncEngine } = useValFieldContext();
  const renders = useSyncExternalStore(
    syncEngine.subscribe("all-renders"),
    () => syncEngine.getAllRendersSnapshot(),
    () => syncEngine.getAllRendersSnapshot(),
  );
  return renders;
}

/**
 * Walks `modulePath` against `sourceData` and returns the record key at which
 * the path descends into a `.jsonValues()` entry whose content has NOT been
 * loaded yet (the value is still a lazy json marker), or `null` otherwise.
 *
 * The sync engine substitutes loaded entry content in place of the marker, so a
 * marker still present here means the entry isn't loaded — the caller should
 * trigger `requestJsonEntry` and render a loading state until it resolves.
 */
function findUnloadedJsonEntryKey(
  modulePath: ModulePath,
  sourceData: Json | undefined,
): string | null {
  if (sourceData === undefined) {
    return null;
  }
  let current: Json = sourceData;
  for (const part of Internal.splitModulePath(modulePath)) {
    if (
      current === null ||
      typeof current !== "object" ||
      isJsonArray(current)
    ) {
      return null;
    }
    const next: Json = current[part];
    if (Internal.isJson(next)) {
      return part;
    }
    current = next;
  }
  return null;
}

function walkSourcePath(
  modulePath: ModulePath,
  sources?: Json,
):
  | {
      status: "success";
      data: Json;
    }
  | {
      status: "error";
      error: string;
    }
  | {
      status: "not-found";
    }
  | {
      status: "loading";
    } {
  let source = sources;
  if (sources === undefined) {
    return { status: "not-found" };
  }
  for (const part of Internal.splitModulePath(modulePath)) {
    if (source === null) {
      return {
        status: "error",
        error: `Expected object at ${modulePath}, got null`,
      };
    }
    if (source === undefined) {
      return {
        status: "error",
        error: `Expected object at ${modulePath}, got undefined`,
      };
    }
    if (typeof source !== "object") {
      return {
        status: "error",
        error: `Expected object at ${modulePath}, got ${JSON.stringify(
          source,
        )}`,
      };
    }
    if (isJsonArray(source)) {
      const index = Number(part);
      if (Number.isNaN(index)) {
        return {
          status: "error",
          error: `Expected number at ${modulePath}, got ${part}`,
        };
      }
      source = source[index];
    } else {
      source = source[part];
    }
  }
  if (source === undefined) {
    return {
      status: "error",
      error: `Expected object at ${modulePath}, got undefined`,
    };
  }
  return { status: "success", data: source };
}

type ShallowSourceOf<SchemaType extends SerializedSchema["type"]> =
  | { status: "not-found" }
  | {
      status: "success";
      clientSideOnly: boolean;
      data: ShallowSource[SchemaType] | null;
    }
  | {
      status: "loading";
      data?: ShallowSource[SchemaType] | null;
    }
  | {
      status: "error";
      data?: ShallowSource[SchemaType] | null;
      error: string;
    };

type ShallowSource = {
  array: SourcePath[];
  object: Record<string, SourcePath>;
  record: Record<string, SourcePath>;
  union: string | Record<string, SourcePath>;
  boolean: boolean;
  keyOf: string;
  route: string;
  number: number;
  string: string;
  date: string;
  dateTime: string;
  color: string;
  file: {
    [FILE_REF_PROP]: string;
    metadata?: { readonly [key: string]: Json };
  };
  image: {
    [FILE_REF_PROP]: string;
    metadata?: { readonly [key: string]: Json };
  };
  literal: string;
  richtext: unknown[];
};

function getShallowSourceAtSourcePath<
  SchemaType extends SerializedSchema["type"],
>(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
  type: SchemaType,
  sources: Json,
  clientSideOnly: boolean,
): ShallowSourceOf<SchemaType> {
  const source = walkSourcePath(modulePath, sources);
  if ("data" in source && source.data !== undefined) {
    const mappedSource = mapSource(
      moduleFilePath,
      modulePath,
      type,
      source.data,
    );
    if (mappedSource.status === "success") {
      return {
        status: "success",
        data: mappedSource.data,
        clientSideOnly,
      };
    }
    return mappedSource;
  }
  return source as ShallowSourceOf<SchemaType>;
}

function mapSource<SchemaType extends SerializedSchema["type"]>(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
  schemaType: SchemaType,
  source: Json,
):
  | {
      status: "success";
      data: ShallowSource[SchemaType] | null;
    }
  | {
      status: "error";
      error: string;
    } {
  if (source === null) {
    return { status: "success", data: null };
  }
  const type: SerializedSchema["type"] = schemaType;
  if (type === "object" || type === "record") {
    if (typeof source !== "object") {
      return {
        status: "error",
        error: `Expected object, got ${typeof source}`,
      };
    }
    if (isJsonArray(source)) {
      return {
        status: "error",
        error: `Expected object, got array`,
      };
    }
    const data: ShallowSource["object" | "record"] = {};
    for (const key of Object.keys(source)) {
      data[key] = concatModulePath(moduleFilePath, modulePath, key);
    }
    return {
      status: "success",
      data: data as ShallowSource[SchemaType],
    };
  } else if (type === "array") {
    if (typeof source !== "object" || !isJsonArray(source)) {
      return {
        status: "error",
        error: `Expected array, got ${typeof source}`,
      };
    }
    const data: ShallowSource["array"] = [];
    for (let i = 0; i < source.length; i++) {
      data.push(concatModulePath(moduleFilePath, modulePath, i));
    }
    return {
      status: "success",
      data: data as ShallowSource[SchemaType],
    };
  } else if (type === "boolean") {
    if (typeof source !== "boolean" && source !== null) {
      return {
        status: "error",
        error: `Expected boolean, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "number") {
    if (typeof source !== "number" && source !== null) {
      return {
        status: "error",
        error: `Expected number, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "richtext") {
    if (typeof source !== "object" || !isJsonArray(source)) {
      return {
        status: "error",
        error: `Expected richtext (i.e. array), got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (
    type === "date" ||
    type === "dateTime" ||
    type === "color" ||
    type === "string" ||
    type === "literal"
  ) {
    if (typeof source !== "string" && source !== null) {
      return {
        status: "error",
        error: `Expected string, got ${typeof source}: ${JSON.stringify(
          source,
        )}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "file" || type === "image") {
    if (
      typeof source !== "object" ||
      !(FILE_REF_PROP in source) ||
      source[FILE_REF_PROP] === undefined
    ) {
      return {
        status: "error",
        error: `Expected object with ${FILE_REF_PROP} property, got ${typeof source}`,
      };
    }
    if (
      "metadata" in source &&
      source.metadata &&
      typeof source.metadata !== "object"
    ) {
      return {
        status: "error",
        error: `Expected metadata of ${type} to be an object, got ${typeof source.metadata}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "keyOf") {
    if (typeof source !== "string") {
      return {
        status: "error",
        error: `Expected string, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "route") {
    if (typeof source !== "string") {
      return {
        status: "error",
        error: `Expected string, got ${typeof source}`,
      };
    }
    return {
      status: "success",
      data: source as ShallowSource[SchemaType],
    };
  } else if (type === "union") {
    if (typeof source === "string") {
      return {
        status: "success",
        data: source as ShallowSource[SchemaType],
      };
    }
    if (typeof source !== "object") {
      return {
        status: "error",
        error: `Expected object, got ${typeof source}`,
      };
    }
    if (isJsonArray(source)) {
      return {
        status: "error",
        error: `Expected object, got array`,
      };
    }
    const data: ShallowSource["union"] = {};
    for (const key of Object.keys(source)) {
      data[key] = concatModulePath(moduleFilePath, modulePath, key);
    }
    return {
      status: "success",
      data: data as ShallowSource[SchemaType],
    };
  } else {
    const exhaustiveCheck: never = type;
    return {
      status: "error",
      error: `Unknown schema type: ${exhaustiveCheck}`,
    };
  }
}

function concatModulePath(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
  key: string | number,
): SourcePath {
  if (!modulePath) {
    return (moduleFilePath + ModuleFilePathSep + key) as SourcePath;
  }
  return (moduleFilePath +
    ModuleFilePathSep +
    modulePath +
    "." +
    JSON.stringify(key)) as SourcePath;
}

export function useShallowSourceAtPath<
  SchemaType extends SerializedSchema["type"],
>(
  sourcePath?: SourcePath | ModuleFilePath,
  type?: SchemaType,
  creatorId?: string,
): ShallowSourceOf<SchemaType> {
  const { syncEngine } = useValFieldContext();
  const sourceOverride = useContext(FieldSourceOverrideContext);
  const [moduleFilePath, modulePath] = sourcePath
    ? Internal.splitModuleFilePathAndModulePath(sourcePath)
    : (["", ""] as [ModuleFilePath, ModulePath]);
  const sourcesRes = useSyncExternalStore(
    syncEngine.subscribe("source", moduleFilePath),
    () => syncEngine.getSourceSnapshot(moduleFilePath),
    () => syncEngine.getSourceSnapshot(moduleFilePath),
  );
  const initializedAt = useSyncEngineInitializedAt(syncEngine);

  const source = useMemo((): ShallowSourceOf<SchemaType> => {
    if (initializedAt === null) {
      return { status: "loading" };
    }
    if (
      sourceOverride &&
      sourceOverride.moduleFilePath === moduleFilePath &&
      type !== undefined
    ) {
      return getShallowSourceAtSourcePath(
        moduleFilePath,
        modulePath,
        type,
        sourceOverride.moduleSource,
        false,
      );
    }
    if (sourcesRes.status === "success") {
      const moduleSources = sourcesRes.data;
      if (moduleSources !== undefined && type !== undefined) {
        const sourceAtSourcePath = getShallowSourceAtSourcePath(
          moduleFilePath,
          modulePath,
          type,
          moduleSources,
          syncEngine.isOptimisticFor(moduleFilePath, creatorId),
        );
        return sourceAtSourcePath;
      } else {
        return { status: "not-found" };
      }
    }
    return {
      status: "error",
      error: sourcesRes.message || "Unknown error",
    };
  }, [
    sourcesRes,
    modulePath,
    moduleFilePath,
    initializedAt,
    type,
    sourceOverride,
    syncEngine,
    creatorId,
  ]);
  return source;
}

const noopSubscribe = () => () => {};
const getNull = () => null;
const NOT_FOUND: { status: "not-found" } = { status: "not-found" };
const EMPTY_PATCH_IDS: ReadonlyMap<string, string> = new Map();

export function useSourceAtPath(sourcePath: SourcePath | ModuleFilePath):
  | {
      status: "success";
      data: Json;
    }
  | {
      status: "error";
      error: string;
    }
  | {
      status: "not-found";
    }
  | {
      status: "loading";
    } {
  const ctx = useContext(ValFieldContext);
  const syncEngine = ctx?.syncEngine ?? null;
  const sourceOverride = useContext(FieldSourceOverrideContext);
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const sourceSnapshot = useSyncExternalStore(
    syncEngine ? syncEngine.subscribe("source", moduleFilePath) : noopSubscribe,
    syncEngine ? () => syncEngine.getSourceSnapshot(moduleFilePath) : getNull,
    syncEngine ? () => syncEngine.getSourceSnapshot(moduleFilePath) : getNull,
  );
  const initializedAt = useSyncExternalStore(
    syncEngine ? syncEngine.subscribe("initialized-at") : noopSubscribe,
    syncEngine ? () => syncEngine.getInitializedAtSnapshot() : getNull,
    syncEngine ? () => syncEngine.getInitializedAtSnapshot() : getNull,
  );
  // A `.jsonValues()` entry's content is loaded lazily: if this path descends
  // into an un-loaded marker, request it and render loading until it resolves.
  const unloadedJsonKey = useMemo(
    () =>
      sourceSnapshot && sourceSnapshot.status === "success"
        ? findUnloadedJsonEntryKey(modulePath, sourceSnapshot.data)
        : null,
    [modulePath, sourceSnapshot],
  );
  useEffect(() => {
    if (syncEngine && unloadedJsonKey !== null) {
      syncEngine.requestJsonEntry(moduleFilePath, unloadedJsonKey);
    }
  }, [syncEngine, moduleFilePath, unloadedJsonKey]);
  const jsonEntryError = useSyncExternalStore(
    syncEngine ? syncEngine.subscribe("source", moduleFilePath) : noopSubscribe,
    () =>
      syncEngine && unloadedJsonKey !== null
        ? syncEngine.getJsonEntryError(moduleFilePath, unloadedJsonKey)
        : null,
    () =>
      syncEngine && unloadedJsonKey !== null
        ? syncEngine.getJsonEntryError(moduleFilePath, unloadedJsonKey)
        : null,
  );
  return useMemo(() => {
    if (!syncEngine) {
      return NOT_FOUND;
    }
    if (initializedAt === null || initializedAt.data === null) {
      return { status: "loading" };
    }
    if (sourceOverride && sourceOverride.moduleFilePath === moduleFilePath) {
      return walkSourcePath(modulePath, sourceOverride.moduleSource);
    }
    if (unloadedJsonKey !== null) {
      // A failed load must not render as a perpetual spinner.
      if (jsonEntryError !== null) {
        return {
          status: "error",
          error: `Could not load entry '${unloadedJsonKey}': ${jsonEntryError}`,
        };
      }
      return { status: "loading" };
    }
    if (sourceSnapshot && sourceSnapshot.status === "success") {
      return walkSourcePath(modulePath, sourceSnapshot.data);
    }
    return {
      status: "error",
      error: (sourceSnapshot && sourceSnapshot.message) || "Unknown error",
    };
  }, [
    syncEngine,
    sourceSnapshot,
    initializedAt,
    modulePath,
    moduleFilePath,
    sourceOverride,
    unloadedJsonKey,
    jsonEntryError,
  ]);
}

/**
 * Like {@link useSourceAtPath} but always returns the source as last seen
 * from the server, ignoring any locally applied (optimistic) patches.
 *
 * Intended for diff / compare views where we need to render the "before"
 * state of a value alongside the current ("after") state.
 */
export function useServerSourceAtPath(sourcePath: SourcePath | ModuleFilePath):
  | {
      status: "success";
      data: Json;
    }
  | {
      status: "error";
      error: string;
    }
  | {
      status: "not-found";
    }
  | {
      status: "loading";
    } {
  const { syncEngine } = useValFieldContext();
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  // Subscribe to the module-level "source" channel so we re-render when the
  // server source changes (e.g. after a successful publish).
  const sourceSnapshot = useSyncExternalStore(
    syncEngine.subscribe("source", moduleFilePath),
    () => syncEngine.getBaseSourceSnapshot(moduleFilePath),
    () => syncEngine.getBaseSourceSnapshot(moduleFilePath),
  );
  const initializedAt = useSyncEngineInitializedAt(syncEngine);
  return useMemo(() => {
    if (initializedAt === null) {
      return { status: "loading" };
    }
    if (sourceSnapshot.status === "success") {
      return walkSourcePath(modulePath, sourceSnapshot.data);
    }
    return {
      status: "error",
      error: sourceSnapshot.status,
    };
  }, [sourceSnapshot, initializedAt, modulePath]);
}

export function useFilePatchIds(): ReadonlyMap<string, string> {
  const ctx = useContext(ValFieldContext);
  const syncEngine = ctx?.syncEngine ?? null;
  const patchesSnapshot = useSyncExternalStore(
    syncEngine ? syncEngine.subscribe("all-patches") : noopSubscribe,
    syncEngine ? () => syncEngine.getAllPatchesSnapshot() : getNull,
    syncEngine ? () => syncEngine.getAllPatchesSnapshot() : getNull,
  );
  return useMemo(() => {
    if (!patchesSnapshot) return EMPTY_PATCH_IDS;
    const map = new Map<string, string>();
    for (const [patchId, data] of Object.entries(patchesSnapshot)) {
      if (data && !data.isCommitted) {
        for (const op of data.patch) {
          if (op.op === "file" && "filePath" in op) {
            map.set(op.filePath as string, patchId);
          }
        }
      }
    }
    return map;
  }, [patchesSnapshot]);
}

export type { ShallowSource };
