import React, {
  useCallback,
  useContext,
  useEffect,
  useId,
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
import { useValSystem, type ValSystem } from "../stores/react/SystemContext";
import type { UploadProgress } from "../stores/PatchStore";
import type { SourcePeek } from "../stores/SourceStore";
import { Patch } from "@valbuild/core/patch";
import { isJsonArray } from "../utils/isJsonArray";
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
  getDirectFileUploadSettings,
  config,
}: {
  children: React.ReactNode;
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
        getDirectFileUploadSettings,
        config,
      }}
    >
      {children}
    </ValFieldContext.Provider>
  );
}

/**
 * `useSyncExternalStore` needs a subscribe function that is stable when there is
 * nothing to subscribe to. Shared by every hook below that tolerates rendering
 * outside a system.
 */
const noopSubscribe = () => () => {};

/**
 * Has the project been taken in?
 *
 * Every read hook checks this first, and for a reason that is not obvious: a
 * module whose schema has not arrived and a module that does not exist look
 * identical to a reader, and only the answer to this question tells them apart.
 * Before intake, absent means "not yet"; after it, absent means "no such
 * module". The engine spent three snapshot statuses (`no-schemas`,
 * `schema-not-found`, `source-not-found`) on that distinction; it is one
 * timestamp and a lookup.
 */
function useInitialized(val: ValSystem | null): number | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      return val.system.host.events.on("host:receive", onChange);
    },
    [val],
  );
  const getSnapshot = useCallback(
    () => (val === null ? null : val.system.host.initializedAt()),
    [val],
  );
  return useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSnapshot,
    getSnapshot,
  );
}

/**
 * The peek at one path, subscribed PER PATH.
 *
 * The single most important line of the port. The engine subscribed per MODULE
 * and walked the path inside each hook, so every mounted field in an edited
 * module re-rendered on every keystroke — 16 of 16 at the benchmark's screen
 * size. This subscribes to the path, and the walk happens in the store, so a
 * keystroke wakes only the fields whose own value moved: 0 in the same
 * measurement, because the only field on that path was the one being typed into
 * and per-instance suppression leaves it alone.
 *
 * The whole reason `SourceStore.peek` is reference-stable is so this can hand it
 * straight to `useSyncExternalStore` with no cache in between.
 */
function usePeek(
  val: ValSystem | null,
  path: SourcePath,
  fieldId: string,
): SourcePeek | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      return val.system.sourceStore.addListener(path, fieldId, onChange);
    },
    [val, path, fieldId],
  );
  const getSnapshot = useCallback(
    () => (val === null ? null : val.system.sourceStore.peek(path)),
    [val, path],
  );
  return useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSnapshot,
    getSnapshot,
  );
}

/**
 * Ask for `.jsonValues()` content the peek says is not here.
 *
 * From an effect, never during render: a fetch started in a render React may
 * re-run or discard is how a fetch storm begins. And only on `entry-missing` —
 * `entry-failed` is deliberately excluded, because retrying from an effect that
 * re-runs when the status changes is an infinite loop that renders as a spinner.
 * That distinction is the entire reason the store has two statuses for it.
 */
function useEntryDemand(
  val: ValSystem | null,
  path: SourcePath,
  seen: SourcePeek | null,
): void {
  useEffect(() => {
    if (val === null || seen === null || seen.status !== "entry-missing") {
      return;
    }
    void val.system.sourceStore.get(path, null);
  }, [val, path, seen]);
}

/**
 * A number that moves when ANY module's source could answer differently.
 *
 * For the whole-project readers only — `useAllSources`, `useSchemas` and the
 * few components built on them. Everything a field reads goes through
 * {@link usePeek} instead, and the difference is the point: this wakes on every
 * keystroke anywhere in the project, which is exactly why `perFieldSubscriptions`
 * has a test forbidding it inside a field.
 */
function useSourcesVersion(val: ValSystem | null): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      return val.system.sourceStore.events.on("source:change", onChange);
    },
    [val],
  );
  const getSnapshot = useCallback(
    () => (val === null ? 0 : val.system.sourceStore.sourcesVersion()),
    [val],
  );
  return useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSnapshot,
    getSnapshot,
  );
}

/** Bumped whenever any module's schema is received or replaced. */
function useSchemasVersion(val: ValSystem | null): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      return val.system.schemaStore.events.on("schema:init", onChange);
    },
    [val],
  );
  // The COUNT of modules with a schema, not a version number: `SchemaStore`
  // keeps versions per module and has no global one, and intake replaces the
  // whole map at once, so the count changes exactly when the map does. The
  // subscription is what actually drives the re-read; this only has to be a
  // stable value that differs afterwards.
  const getSnapshot = useCallback(
    () => (val === null ? 0 : Object.keys(val.system.schemaStore.all()).length),
    [val],
  );
  return useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSnapshot,
    getSnapshot,
  );
}

export type LoadingStatus = "loading" | "not-asked" | "error" | "success";

/**
 * Is the system busy?
 *
 * The engine counted queued operations, most of which were reads it had issued
 * itself; the stores have no such queue, because a read is demand-driven and
 * belongs to whoever asked. What is left is the one thing this was ever used to
 * show: whether the user's edits have reached the server.
 *
 * Callers use it as a gate ("don't report not-found while still loading"), so
 * `loading` before intake matters more than the write state does.
 */
export function useLoadingStatus(): LoadingStatus {
  const val = useValSystem();
  const initializedAt = useInitialized(val);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      return val.system.patchSync.events.on("patch:sync-state", onChange);
    },
    [val],
  );
  const getSyncState = useCallback(
    () => (val === null ? null : val.system.patchSync.currentState()),
    [val],
  );
  const syncState = useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSyncState,
    getSyncState,
  );
  if (val === null) {
    return "not-asked";
  }
  if (initializedAt === null) {
    return "loading";
  }
  return syncState !== null && syncState.status === "in-sync"
    ? "success"
    : "loading";
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
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const patchPath = useMemo(() => {
    return Internal.createPatchPath(modulePath);
  }, [modulePath]);
  /**
   * The single choke point for field writes.
   *
   * `addPatch`, `addPatchAwaitable` and `addModuleFilePatch` all come here, which
   * is why the store system became the writer in one function rather than at
   * twenty call sites.
   *
   * ## One writer, and why it has to be
   *
   * The server keeps ONE linear patch chain and checks every `parentRef`, so two
   * systems minting ids means a 409 on every keystroke. Only the system that
   * writes may mint, and this is it: `PatchStore.createPatch` mints the id,
   * applies the patch to source, and hands it to `PatchSync` to be saved.
   *
   * ## What a caller sees when it fails
   *
   * `createPatch` can genuinely fail before any patch exists — an upload can
   * fail — and that is the real outcome of a write, not something happening in a
   * mirror. So a failure is NOT swallowed and nothing is applied locally either:
   * showing an edit the server will never have is how a user comes to trust a
   * value that does not exist.
   *
   * ## Ordering, for a patch that carries bytes
   *
   * `PatchStore.createPatch` uploads first, then records the patch, then runs
   * deletes — and rolls back the uploads if any of them fails, so nothing ever
   * references a file that is not there. That is why the whole patch is handed
   * over rather than split here: the ordering rule lives with the store that
   * owns it.
   */
  const val = useValSystem();
  const writePatch = useCallback(
    async (
      target: ModuleFilePath,
      patch: Patch,
      onProgress?: UploadProgress,
      /** What kind of binary any `file` ops carry. See `PatchStore.createPatch`. */
      fileType?: "image" | "file",
    ): Promise<
      { status: "ok"; patchId: PatchId } | { status: "error"; message: string }
    > => {
      if (val === null) {
        // Said out loud rather than dropped silently. Reachable only for a
        // Studio rendered with no system at all — a story, a preview — where an
        // edit genuinely has nowhere to go.
        return {
          status: "error",
          message:
            "Cannot write: no store system is mounted. The edit was dropped.",
        };
      }
      const res = await val.system.patchStore.createPatch(
        target,
        patch,
        undefined,
        creatorId,
        onProgress,
        undefined,
        undefined,
        fileType,
      );
      if (res.status !== "created") {
        return { status: "error", message: res.message };
      }
      return { status: "ok", patchId: res.record.patchId };
    },
    [val, creatorId],
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
      // `type` reaches the store now. It used to stop here, and the store then
      // guessed the kind from `op.remote` — a different question, so a remote
      // image was uploaded as a "file".
      const res = await writePatch(moduleFilePath, patch, onProgress, type);
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
  const val = useValSystem();
  const path = sourcePath as SourcePath;
  const initializedAt = useInitialized(val);
  /**
   * Registering interest IS the demand signal.
   *
   * `RenderStore` listens for `source:listen` and computes a render for the
   * paths that have listeners on them — which is what makes one visible row cost
   * one `select` call instead of the whole module. So this hook subscribes even
   * though it does not read source: mounting is the thing that asks.
   */
  const ownId = useId();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      const offSource = val.system.sourceStore.addListener(
        path,
        ownId,
        onChange,
      );
      const offResult = val.system.renderStore.events.on(
        "render:result",
        onChange,
      );
      const offInvalidate = val.system.renderStore.events.on(
        "render:invalidate",
        onChange,
      );
      const offError = val.system.renderStore.events.on(
        "render:error",
        onChange,
      );
      return () => {
        offSource();
        offResult();
        offInvalidate();
        offError();
      };
    },
    [val, path, ownId],
  );
  const getSnapshot = useCallback(
    () => (val === null ? null : val.system.renderStore.peek(path)),
    [val, path],
  );
  const seen = useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSnapshot,
    getSnapshot,
  );

  /**
   * Compute a render this module does not have.
   *
   * Only on `needs-render`, which is exactly the state that says asking would
   * help. `no-render` means the schema declares none, and asking for it forever
   * is the loop the store added `needs-render` to make impossible — the same
   * distinction, for the same reason, as `entry-missing` against `entry-failed`.
   */
  useEffect(() => {
    if (val === null || seen === null || seen.status !== "needs-render") {
      return;
    }
    void val.system.renderStore.get(path);
  }, [val, path, seen]);

  return useMemo<RenderOverrideAtPathResult>(() => {
    if (val === null || seen === null) {
      return undefined;
    }
    if (initializedAt === null || seen.status === "needs-render") {
      // Before intake, and while a render is owed, `loading` — with no data,
      // because there is none yet. The engine returned the previous render's
      // data here; it could, because it recomputed eagerly and therefore always
      // had one. Nothing shows a stale render in the meantime, which is the
      // honest reading of "not computed".
      return { status: "loading" };
    }
    switch (seen.status) {
      case "rendered":
        // Already a `WithStatus<RenderTypes>` — the store caches what the host
        // produced, statuses and all — so it is returned as it is rather than
        // wrapped again.
        return seen.render;
      case "error":
        // `message`, not `error`: `WithStatus` in core names it that, and this
        // hook returns core's own shape rather than a translation of it.
        return { status: "error", message: seen.message };
      case "no-render":
      case "no-render-at-path":
        return undefined;
    }
  }, [val, seen, initializedAt]);
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
  const val = useValSystem();
  const sourceOverride = useContext(FieldSourceOverrideContext);
  const path = sourcePath as SourcePath;
  const [moduleFilePath, modulePath] = useMemo(() => {
    return Internal.splitModuleFilePathAndModulePath(path);
  }, [path]);
  const initializedAt = useInitialized(val);
  const schemaVersion = useSchemasVersion(val);
  /**
   * Per PATH, not per module — see {@link usePeek}.
   *
   * Resolving a schema against a path needs the module's source, which this hook
   * reads on demand below. But it only needs to RESOLVE AGAIN when something on
   * this path changed shape, and `touchesPath` already matches both directions:
   * an ancestor being replaced wakes this, and so does an edit beneath it. A
   * sibling's keystroke does neither, and must not.
   */
  const ownId = useId();
  const seen = usePeek(val, path, ownId);
  useEntryDemand(val, path, seen);

  const resolvedSchemaAtPathRes = useMemo<ResolvedSchemaAtPathResult>(() => {
    if (val === null) {
      return { status: "loading" };
    }
    void schemaVersion;
    const schema = val.system.schemaStore.get(moduleFilePath);
    if (schema === undefined) {
      // Before intake this is "not yet"; after it, there is no such module. The
      // timestamp is the only thing that tells them apart — see
      // {@link useInitialized}.
      return initializedAt === null
        ? { status: "loading" }
        : { status: "module-schema-not-found" };
    }
    /**
     * The override wins, and it is not a fallback.
     *
     * A compare view renders the "before" side by handing the committed module
     * source down through context. Reading the store instead would show the
     * patched value on both sides of a diff, which is a diff that always looks
     * empty.
     */
    const sourceData =
      sourceOverride && sourceOverride.moduleFilePath === moduleFilePath
        ? sourceOverride.moduleSource
        : val.system.sourceStore.moduleSource(moduleFilePath);
    if (seen !== null && sourceOverride === null) {
      if (seen.status === "entry-loading" || seen.status === "entry-missing") {
        return { status: "loading" };
      }
      if (seen.status === "entry-failed") {
        // A failed load must not render as a perpetual spinner.
        return {
          status: "error",
          error: `Could not load entry '${seen.key}': ${seen.message}`,
        };
      }
    }
    if (sourceData === undefined) {
      return initializedAt === null
        ? { status: "loading" }
        : { status: "source-not-found" };
    }

    try {
      const resolved = Internal.safeResolvePath(modulePath, sourceData, schema);
      if (resolved.status === "error") {
        return { status: "error", error: resolved.message };
      }
      if (resolved.status === "source-undefined") {
        return { status: "source-not-found" };
      }
      if (!resolved.schema) {
        return { status: "resolved-schema-not-found" };
      }
      const resolvedModulePath = resolved.path as unknown as ModulePath;
      const resolvedSourcePath = resolvedModulePath
        ? Internal.joinModuleFilePathAndModulePath(
            moduleFilePath,
            resolvedModulePath,
          )
        : (moduleFilePath as unknown as SourcePath);
      return {
        status: "success",
        data: resolved.schema,
        resolvedPath: resolvedSourcePath,
      };
    } catch (e) {
      console.error(
        "Error resolving schema at path",
        sourcePath,
        modulePath,
        sourceData,
        schema,
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
    val,
    schemaVersion,
    seen,
    sourceOverride,
    moduleFilePath,
    modulePath,
    sourcePath,
    initializedAt,
  ]);

  /**
   * Memoised, and it is not a micro-optimisation: this hook's result is a
   * dependency of effects all over the app, so an unstable reference is a render
   * loop. The narrowing below built a FRESH object on every render for every
   * status — `{ status: "loading" }`, `{ status: "not-found" }` — and the one
   * memoised branch (`resolvedSchemaAtPathRes`) was the success case only. On a
   * `.jsonValues()` record that was 346 renders in 15 seconds, ending in
   * "Maximum update depth exceeded" out of a Radix ref callback.
   *
   * Same rule as `SourceStore.peek` and `ValidationStore.peek`: whatever a
   * render path reads owes it a stable reference.
   */
  return useMemo<SchemaWithResolvedPathResult>(() => {
    if (initializedAt === null) {
      return { status: "loading" };
    }
    if (resolvedSchemaAtPathRes.status !== "success") {
      switch (resolvedSchemaAtPathRes.status) {
        case "resolved-schema-not-found":
        case "source-not-found":
        case "module-schema-not-found":
        case "schema-not-found":
          return { status: "not-found" };
        case "no-schemas":
          return { status: "error", error: "No schemas" };
        case "error":
          return { status: "error", error: resolvedSchemaAtPathRes.error };
        case "loading":
          return { status: "loading" };
      }
    }
    return resolvedSchemaAtPathRes;
  }, [resolvedSchemaAtPathRes, initializedAt]);
}

export function useSchemaAtPath(
  sourcePath: SourcePath | ModuleFilePath,
): SchemaAtPathResult {
  const res = useSchemaAtPathInternal(sourcePath);
  // Memoised for the same reason as the internal hook above: dropping
  // `resolvedPath` by building a new object made every render a new reference.
  return useMemo<SchemaAtPathResult>(() => {
    if (res.status === "success") {
      return { status: "success", data: res.data };
    }
    return res;
  }, [res]);
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
  const val = useValSystem();
  const initializedAt = useInitialized(val);
  const schemaVersion = useSchemasVersion(val);
  return useMemo(() => {
    if (val === null || initializedAt === null) {
      return { status: "loading" };
    }
    void schemaVersion;
    // The store's own record, not a copy. The engine deep-cloned every schema on
    // every read of this; nothing downstream writes to a schema, so the clone
    // bought only the cost of copying the project's schemas on each keystroke
    // that invalidated the cache.
    return { status: "success", data: val.system.schemaStore.all() };
  }, [val, initializedAt, schemaVersion]);
}

export function useAllSources(): Record<ModuleFilePath, Json> {
  const val = useValSystem();
  const version = useSourcesVersion(val);
  return useMemo(() => {
    if (val === null) {
      return {};
    }
    void version;
    return val.system.sourceStore.allSources();
  }, [val, version]);
}

/**
 * Resolves a navigation path, reading every module's source and schema ON DEMAND
 * rather than subscribing to them.
 *
 * Use this - never `useAllSources()` + `useSchemas()` - whenever the data is only
 * ever read inside an event handler.
 *
 * Both of those are whole-PROJECT subscriptions: they wake on every keystroke
 * anywhere in the Studio. `Field` wraps every leaf field, so subscribing there
 * made a single keystroke O(project size) - for data that only a click handler
 * ever looked at. `perFieldSubscriptions.test.ts` is what keeps that from coming
 * back.
 */
export function useGetNavPath(): (
  path: SourcePath | ModuleFilePath,
) => SourcePath | ModuleFilePath | null {
  const val = useValSystem();
  return useCallback(
    (path: SourcePath | ModuleFilePath) => {
      if (val === null) {
        return null;
      }
      return getNavPathFromAll(
        path,
        val.system.sourceStore.allSources(),
        val.system.schemaStore.all(),
      );
    },
    [val],
  );
}

/**
 * Progress of the `.jsonValues()` entries the project has loaded so far.
 *
 * NOTE: `percentage` is 100 while `status` is `"idle"`, so check the status
 * before showing it.
 *
 * Counted from source and the loaded map on every read, rather than accumulated
 * as fetches are issued. The engine counted requests and resolutions, which made
 * the total the number of entries someone had ASKED for — so the bar restarted
 * every time a new module was opened, and reached 100% while entries were still
 * missing. These two numbers come from the same place a read does, so a full bar
 * means the content is actually there.
 */
export function useJsonEntriesProgress(): JsonEntriesProgress {
  const val = useValSystem();
  const version = useSourcesVersion(val);
  return useMemo<JsonEntriesProgress>(() => {
    if (val === null) {
      return { status: "idle", loaded: 0, total: 0, percentage: 100 };
    }
    void version;
    const { total, loaded } = val.system.sourceStore.allEntriesProgress();
    if (total === 0 || loaded === total) {
      return { status: "idle", loaded, total, percentage: 100 };
    }
    return {
      status: "loading",
      loaded,
      total,
      percentage: Math.round((loaded / total) * 100),
    };
  }, [val, version]);
}

export function useAllRenders(): Record<ModuleFilePath, ReifiedRender | null> {
  const val = useValSystem();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      const offResult = val.system.renderStore.events.on(
        "render:result",
        onChange,
      );
      const offInvalidate = val.system.renderStore.events.on(
        "render:invalidate",
        onChange,
      );
      const offError = val.system.renderStore.events.on(
        "render:error",
        onChange,
      );
      return () => {
        offResult();
        offInvalidate();
        offError();
      };
    },
    [val],
  );
  const getSnapshot = useCallback(
    () => (val === null ? EMPTY_RENDERS : val.system.renderStore.all()),
    [val],
  );
  return useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSnapshot,
    getSnapshot,
  );
}

const EMPTY_RENDERS: Record<ModuleFilePath, ReifiedRender | null> = {};

/**
 * How far the `.jsonValues()` entry load has got. See
 * {@link useJsonEntriesProgress}.
 */
export type JsonEntriesProgress = {
  status: "idle" | "loading";
  loaded: number;
  total: number;
  /** 100 while idle — check `status` first. */
  percentage: number;
};

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
  const val = useValSystem();
  const sourceOverride = useContext(FieldSourceOverrideContext);
  const path = (sourcePath ?? "") as SourcePath;
  const [moduleFilePath, modulePath] = sourcePath
    ? Internal.splitModuleFilePathAndModulePath(path)
    : (["", ""] as [ModuleFilePath, ModulePath]);
  const initializedAt = useInitialized(val);
  /**
   * The creator id is the READ id too, and that is the whole of per-instance
   * suppression.
   *
   * `SourceStore` compares the id that registered the listener with the id that
   * created the patch, and leaves the match asleep. A field that reads under one
   * id and writes under another is therefore woken by its own keystroke — which
   * is the bug `useValField` exists to make unrepresentable, and which
   * `hooks.test.tsx` pins by asserting the broken behaviour when the ids differ.
   *
   * `useId` is the fallback for a read-only reader: a distinct instance, so it
   * is correctly woken by everything.
   */
  const ownId = useId();
  const seen = usePeek(val, path, creatorId ?? ownId);
  useEntryDemand(val, path, seen);

  return useMemo((): ShallowSourceOf<SchemaType> => {
    if (val === null || initializedAt === null || seen === null) {
      return { status: "loading" };
    }
    if (
      sourceOverride &&
      sourceOverride.moduleFilePath === moduleFilePath &&
      type !== undefined
    ) {
      return walkShallowSource(
        moduleFilePath,
        modulePath,
        type,
        sourceOverride.moduleSource,
        false,
      );
    }
    if (type === undefined) {
      return { status: "not-found" };
    }
    switch (seen.status) {
      case "module-loading":
      case "entry-missing":
      case "entry-loading":
        return { status: "loading" };
      case "entry-failed":
        return {
          status: "error",
          error: `Could not load entry '${seen.key}': ${seen.message}`,
        };
      case "absent":
        return { status: "not-found" };
      case "ready":
        return mapShallowSource(
          moduleFilePath,
          modulePath,
          type,
          seen.data,
          /**
           * `clientSideOnly` — does this field have an unsaved edit of its own?
           *
           * A controlled input holds its own draft and resets it from source;
           * it must not do that while showing an edit the server has not
           * acknowledged, or the caret jumps and a fast typist loses characters.
           *
           * The engine asked "is the LAST patch in the chain yours", which goes
           * false the moment anyone else writes even though your edit is still
           * unsaved. This asks whether you have an unsaved patch at all, which
           * is what the input is actually asking. Without a `creatorId` there is
           * no instance to ask about, and the answer is no — the same as the
           * engine, which returned `false` for a missing creator.
           */
          creatorId !== undefined &&
            val.system.patchStore.hasUnsavedFrom(moduleFilePath, creatorId),
        );
    }
  }, [
    val,
    seen,
    initializedAt,
    modulePath,
    moduleFilePath,
    type,
    sourceOverride,
    creatorId,
  ]);
}

/**
 * A value already AT the path, mapped to the shallow shape a field renders.
 *
 * The common case: `peek` resolved the path in the store, so there is nothing
 * left to walk. {@link walkShallowSource} is the other one.
 */
function mapShallowSource<SchemaType extends SerializedSchema["type"]>(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
  type: SchemaType,
  data: Json,
  clientSideOnly: boolean,
): ShallowSourceOf<SchemaType> {
  const mapped = mapSource(moduleFilePath, modulePath, type, data);
  if (mapped.status === "success") {
    return { status: "success", data: mapped.data, clientSideOnly };
  }
  return mapped;
}

/**
 * The same, for a whole MODULE source that still has to be walked.
 *
 * Only the compare view needs this: it supplies the committed module through
 * `FieldSourceOverrideContext`, so no store resolved the path and the walk has
 * to happen here.
 */
function walkShallowSource<SchemaType extends SerializedSchema["type"]>(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
  type: SchemaType,
  moduleSource: Json,
  clientSideOnly: boolean,
): ShallowSourceOf<SchemaType> {
  const walked = walkSourcePath(modulePath, moduleSource);
  if (walked.status !== "success") {
    return walked;
  }
  return mapShallowSource(
    moduleFilePath,
    modulePath,
    type,
    walked.data,
    clientSideOnly,
  );
}

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
  const val = useValSystem();
  const sourceOverride = useContext(FieldSourceOverrideContext);
  const path = sourcePath as SourcePath;
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const initializedAt = useInitialized(val);
  const ownId = useId();
  const seen = usePeek(val, path, ownId);
  useEntryDemand(val, path, seen);

  return useMemo(() => {
    if (val === null) {
      return NOT_FOUND;
    }
    if (initializedAt === null || seen === null) {
      return { status: "loading" };
    }
    if (sourceOverride && sourceOverride.moduleFilePath === moduleFilePath) {
      return walkSourcePath(modulePath, sourceOverride.moduleSource);
    }
    switch (seen.status) {
      case "ready":
        return { status: "success", data: seen.data };
      case "absent":
        return NOT_FOUND;
      case "module-loading":
      case "entry-missing":
      case "entry-loading":
        return { status: "loading" };
      case "entry-failed":
        return {
          status: "error",
          error: `Could not load entry '${seen.key}': ${seen.message}`,
        };
    }
  }, [val, seen, initializedAt, modulePath, moduleFilePath, sourceOverride]);
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
  const val = useValSystem();
  const path = sourcePath as SourcePath;
  const initializedAt = useInitialized(val);
  /**
   * Subscribed at the path like every other reader, even though base source only
   * moves on intake and on a publish.
   *
   * `peekBase` walks the same path against `baseSources`, so the two answers are
   * comparable by construction — which is the entire point of a compare view. And
   * a publish promotes patched source to base, which wakes the path: without the
   * subscription the "before" side would still show the pre-publish value after
   * the change had shipped.
   */
  const ownId = useId();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      return val.system.sourceStore.addListener(path, ownId, onChange);
    },
    [val, path, ownId],
  );
  const getSnapshot = useCallback(
    () => (val === null ? null : val.system.sourceStore.peekBase(path)),
    [val, path],
  );
  const seen = useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSnapshot,
    getSnapshot,
  );

  return useMemo(() => {
    if (val === null) {
      return NOT_FOUND;
    }
    if (initializedAt === null || seen === null) {
      return { status: "loading" };
    }
    switch (seen.status) {
      case "ready":
        return { status: "success", data: seen.data };
      case "absent":
        return NOT_FOUND;
      case "module-loading":
      case "entry-missing":
      case "entry-loading":
        return { status: "loading" };
      case "entry-failed":
        return {
          status: "error",
          error: `Could not load entry '${seen.key}': ${seen.message}`,
        };
    }
  }, [val, seen, initializedAt]);
}

/**
 * File path -> the pending patch that carries its bytes, so a just-uploaded
 * image can be fetched from `/api/val/files{path}?patch_id=...` before it is
 * published.
 */
export function useFilePatchIds(): ReadonlyMap<string, string> {
  const val = useValSystem();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      // One event, from the one place the chain version moves. Listing the five
      // specific ones instead is a list that has to stay complete forever — and
      // it was already incomplete: `markSaved` emits none of them.
      return val.system.patchStore.events.on("patch:chain", onChange);
    },
    [val],
  );
  const getSnapshot = useCallback(
    () =>
      val === null ? EMPTY_PATCH_IDS : val.system.patchStore.filePatchIds(),
    [val],
  );
  return useSyncExternalStore(
    val === null ? noopSubscribe : subscribe,
    getSnapshot,
    getSnapshot,
  );
}

export type { ShallowSource };
