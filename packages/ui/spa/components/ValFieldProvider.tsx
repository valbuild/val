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
  SerializedSchema,
  SourcePath,
  ValConfig,
} from "@valbuild/core";
import { Operation, Patch, FileOperation } from "@valbuild/core/patch";
import { ParentRef } from "@valbuild/shared/internal";
import { isJsonArray } from "../utils/isJsonArray";
import { ValSyncEngine } from "../ValSyncEngine";
import { z } from "zod";

type ValFieldContextValue = {
  syncEngine: ValSyncEngine;
  getDirectFileUploadSettings: () => Promise<
    | {
        status: "success";
        data: {
          nonce: string | null;
          baseUrl: string;
        };
      }
    | {
        status: "error";
        error: string;
      }
  >;
  config: ValConfig | undefined;
};

const ValFieldContext = React.createContext<ValFieldContextValue>(
  new Proxy(
    {},
    {
      get: () => {
        throw new Error(
          "Cannot use ValFieldContext outside of ValFieldProvider",
        );
      },
    },
  ) as ValFieldContextValue,
);

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

export type LoadingStatus = "loading" | "not-asked" | "error" | "success";
export function useLoadingStatus(): LoadingStatus {
  const { syncEngine } = useContext(ValFieldContext);
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

const textEncoder = new TextEncoder();
const SavePatchFileResponse = z.object({
  patchId: z.string().refine((v): v is PatchId => v.length > 0),
  filePath: z.string().refine((v): v is ModuleFilePath => v.length > 0),
});

export function useAddPatch(sourcePath: SourcePath | ModuleFilePath) {
  const { syncEngine, getDirectFileUploadSettings } =
    useContext(ValFieldContext);
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const patchPath = useMemo(() => {
    return Internal.createPatchPath(modulePath);
  }, [modulePath]);
  const addPatch = useCallback(
    (patch: Patch, type: SerializedSchema["type"]) => {
      syncEngine.addPatch(moduleFilePath, type, patch, Date.now());
    },
    [syncEngine, moduleFilePath],
  );
  const addPatchAwaitable = useCallback(
    (patch: Patch, type: SerializedSchema["type"], patchId: PatchId) => {
      return syncEngine.addPatchAwaitable(
        moduleFilePath,
        type,
        patch,
        patchId,
        Date.now(),
      );
    },
    [syncEngine, moduleFilePath],
  );
  const addModuleFilePatch = useCallback(
    (
      moduleFilePath: ModuleFilePath,
      patch: Patch,
      type: SerializedSchema["type"],
    ) => {
      syncEngine.addPatch(moduleFilePath, type, patch, Date.now());
    },
    [syncEngine],
  );

  const uploadPatchFile = useCallback(
    async (
      baseUrl: string,
      nonce: string | null,
      parentRef: ParentRef,
      patchId: PatchId,
      type: "file" | "image",
      op: FileOperation,
      onProgress: (bytesUploaded: number, totalBytes: number) => void,
    ): Promise<
      | { status: "done"; patchId: PatchId; filePath: string }
      | {
          status: "error";
          error: {
            message: string;
          };
        }
    > => {
      const authHeaders = nonce
        ? {
            "x-val-auth-nonce": nonce,
          }
        : {};
      const { filePath: filePathOrRef, value: data, metadata, remote } = op;

      let filePath: string;
      if (remote) {
        const splitRemoteRefDataRes =
          Internal.remote.splitRemoteRef(filePathOrRef);
        if (splitRemoteRefDataRes.status === "error") {
          return Promise.reject({
            status: "error",
            error: {
              message: `Could not create correct file path of remote file (${splitRemoteRefDataRes.error}). This is most likely a Val bug.`,
            },
          });
        }
        filePath = "/" + splitRemoteRefDataRes.filePath;
      } else {
        filePath = filePathOrRef;
      }
      const payload = JSON.stringify({
        filePath,
        parentRef,
        data,
        type,
        metadata,
        remote,
      });

      const totalBytes = textEncoder.encode(payload).length;

      onProgress(0, totalBytes);

      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            onProgress(event.loaded, event.total);
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const responseText = xhr.responseText;
              const responseData = JSON.parse(responseText);
              const parsed = SavePatchFileResponse.safeParse(responseData);

              if (parsed.success) {
                resolve({
                  status: "done",
                  patchId: parsed.data.patchId,
                  filePath: parsed.data.filePath,
                });
              } else {
                resolve({
                  status: "error",
                  error: {
                    message: `While saving a file we got an unexpected response (${responseText?.slice(
                      0,
                      100,
                    )}...)`,
                  },
                });
              }
            } catch (e) {
              resolve({
                status: "error",
                error: {
                  message: `Got an exception while saving a file. Error: ${
                    e instanceof Error ? e.message : String(e)
                  }`,
                },
              });
            }
          } else {
            resolve({
              status: "error",
              error: {
                message:
                  "Could not save patch file. HTTP error: " +
                  xhr.status +
                  " " +
                  xhr.statusText,
              },
            });
          }
        });

        xhr.addEventListener("error", () => {
          resolve({
            status: "error",
            error: {
              message: `Could save source file (network error?)`,
            },
          });
        });

        xhr.addEventListener("abort", () => {
          resolve({
            status: "error",
            error: {
              message: "Upload was aborted",
            },
          });
        });

        xhr.responseType = "text";
        xhr.open("POST", `${baseUrl}/patches/${patchId}/files`);

        xhr.setRequestHeader("Content-Type", "application/json");
        for (const [key, value] of Object.entries(authHeaders)) {
          xhr.setRequestHeader(key, value);
        }

        xhr.send(payload);
      });
    },
    [],
  );
  const parentRef = useSyncExternalStore(
    syncEngine.subscribe("parent-ref"),
    () => syncEngine.getParentRefSnapshot(),
    () => syncEngine.getParentRefSnapshot(),
  );
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
      if (parentRef === null) {
        onError("Cannot upload files yet. Not initialized.");
        return;
      }
      const directFileUploadSettings = await getDirectFileUploadSettings();
      if (directFileUploadSettings.status !== "success") {
        onError(directFileUploadSettings.error);
        return;
      }
      const { baseUrl, nonce } = directFileUploadSettings.data;
      const fileOps: FileOperation[] = [];
      const patchOps: Operation[] = [];
      for (const op of patch) {
        if (op.op === "file") {
          fileOps.push(op);
          patchOps.push({
            ...op,
            value:
              typeof op.value === "string"
                ? Internal.getSHA256Hash(textEncoder.encode(op.value))
                : op.value,
          });
        } else {
          patchOps.push(op);
        }
      }
      const patchId = syncEngine.createPatchId();
      let currentFile = 0;
      for (const fileOp of fileOps) {
        const res = await uploadPatchFile(
          baseUrl,
          nonce,
          parentRef,
          patchId,
          type,
          fileOp,
          (bytesUploaded, totalBytes) => {
            onProgress(bytesUploaded, totalBytes, currentFile, fileOps.length);
          },
        );
        if (res.status === "error") {
          onError(res.error.message);
          return;
        }
        currentFile++;
      }
      const addPatchRes = await addPatchAwaitable(patchOps, type, patchId);
      if (addPatchRes.status !== "patch-synced") {
        onError(addPatchRes.message);
        return;
      }
    },
    [
      getDirectFileUploadSettings,
      addPatchAwaitable,
      uploadPatchFile,
      parentRef,
      syncEngine,
    ],
  );
  return {
    patchPath,
    addPatch,
    addAndUploadPatchWithFileOps,
    addModuleFilePatch,
  };
}

export function useValConfig() {
  const { config } = useContext(ValFieldContext);
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

export function useRenderOverrideAtPath(
  sourcePath: SourcePath | ModuleFilePath,
) {
  const { syncEngine } = useContext(ValFieldContext);
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
  return useMemo(() => {
    const isOptimistic =
      sourcesRes.status === "success" && sourcesRes.optimistic;
    const renderAtPath = renderRes?.[sourcePath];
    if (initializedAt === null || isOptimistic) {
      const renderData =
        renderAtPath && "data" in renderAtPath ? renderAtPath?.data : undefined;
      return { status: "loading" as const, data: renderData };
    }
    return renderAtPath;
  }, [renderRes, initializedAt, sourcesRes, sourcePath]);
}

export function useSchemaAtPath(sourcePath: SourcePath | ModuleFilePath):
  | { status: "not-found" }
  | { status: "loading" }
  | {
      status: "success";
      data: SerializedSchema;
    }
  | {
      status: "error";
      error: string;
    } {
  const { syncEngine } = useContext(ValFieldContext);
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
  const resolvedSchemaAtPathRes = useMemo(() => {
    if (schemaRes.status !== "success") {
      return schemaRes;
    }
    if (sourcesRes.status !== "success") {
      return sourcesRes;
    }
    let resolvedSchemaAtPath: SerializedSchema | null = null;

    try {
      const resolvedSchemaAtPathRes = Internal.safeResolvePath(
        modulePath,
        sourcesRes.data,
        schemaRes.data,
      );
      if (resolvedSchemaAtPathRes.status === "error") {
        return {
          status: "error" as const,
          error: resolvedSchemaAtPathRes.message,
        };
      }
      if (resolvedSchemaAtPathRes.status === "source-undefined") {
        return {
          status: "source-not-found" as const,
        };
      }
      resolvedSchemaAtPath = resolvedSchemaAtPathRes.schema;
    } catch (e) {
      console.error(
        "Error resolving schema at path",
        sourcePath,
        modulePath,
        sourcesRes.data,
        schemaRes.data,
        e,
      );
      return {
        status: "error" as const,
        error: `Error resolving schema at path: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
    if (!resolvedSchemaAtPath) {
      return {
        status: "resolved-schema-not-found" as const,
      };
    }
    return {
      status: "success" as const,
      data: resolvedSchemaAtPath,
    };
  }, [schemaRes, sourcesRes, moduleFilePath, modulePath]);
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
    return {
      status: "loading",
    };
  }
  return resolvedSchemaAtPathRes;
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
  const { syncEngine } = useContext(ValFieldContext);
  const schemas = useSyncExternalStore(
    syncEngine.subscribe("schema"),
    () => syncEngine.getAllSchemasSnapshot(),
    () => syncEngine.getAllSchemasSnapshot(),
  );

  const initializedAt = useSyncEngineInitializedAt(syncEngine);
  if (initializedAt === null) {
    return { status: "loading" } as const;
  }
  if (schemas === null) {
    console.warn("Schemas: not found");
    return {
      status: "error",
      error: "Schemas not found",
    } as const;
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
  } as const;
}

export function useAllSources() {
  const { syncEngine } = useContext(ValFieldContext);
  const sources = useSyncExternalStore(
    syncEngine.subscribe("all-sources"),
    () => syncEngine.getAllSourcesSnapshot(),
    () => syncEngine.getAllSourcesSnapshot(),
  );
  return sources;
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
  } else if (type === "date" || type === "string" || type === "literal") {
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
): ShallowSourceOf<SchemaType> {
  const { syncEngine } = useContext(ValFieldContext);
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
    if (sourcesRes.status === "success") {
      const moduleSources = sourcesRes.data;
      if (moduleSources !== undefined && type !== undefined) {
        const sourceAtSourcePath = getShallowSourceAtSourcePath(
          moduleFilePath,
          modulePath,
          type,
          moduleSources,
          sourcesRes.optimistic,
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
  }, [sourcesRes, modulePath, moduleFilePath, initializedAt, type]);
  return source;
}

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
  const { syncEngine } = useContext(ValFieldContext);
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const sourceSnapshot = useSyncExternalStore(
    syncEngine.subscribe("source", moduleFilePath),
    () => syncEngine.getSourceSnapshot(moduleFilePath),
    () => syncEngine.getSourceSnapshot(moduleFilePath),
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
      error: sourceSnapshot.message || "Unknown error",
    };
  }, [sourceSnapshot, initializedAt, modulePath, moduleFilePath]);
}

export type { ShallowSource };
