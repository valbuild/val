import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
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
  ValidationError,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { ValClient } from "@valbuild/shared/internal";
import { Remote } from "../utils/Remote";
import { isJsonArray } from "../utils/isJsonArray";
import { DayPickerProvider } from "react-day-picker";
import { DeletePatchesRes, useValState } from "../hooks/useValState";
import { AuthenticationState } from "spa/hooks/useStatus";

type ValContextValue = {
  mode: "http" | "fs" | "unknown";
  serviceUnavailable: boolean | undefined;
  baseSha: string | undefined;
  getCommitSummary: () => Promise<
    | { commitSummary: string | null; error?: undefined }
    | {
        commitSummary?: undefined;
        error: string;
      }
  >;
  portalRef: HTMLElement | null;
  theme: Themes | null;
  setTheme: (theme: Themes | null) => void;
  config: ValConfig | undefined;
  authenticationState: AuthenticationState;
  addPatch: (moduleFilePath: ModuleFilePath, patch: Patch) => void;
  getPatches: (patchIds: PatchId[]) => Promise<GetPatchRes>;
  deletePatches: (patchIds: PatchId[]) => Promise<DeletePatchesRes>;
  addDebouncedPatch: (get: () => Patch, path: SourcePath) => void;
  publish: () => void;
  isPublishing: boolean;
  publishError: string | null;
  resetPublishError: () => void;
  schemas: Remote<Record<ModuleFilePath, SerializedSchema>>;
  schemaSha: string | undefined;
  sources: Record<ModuleFilePath, Json | undefined>;
  validationErrors: Record<SourcePath, ValidationError[]>;
  sourcesSyncStatus: Record<
    ModuleFilePath,
    | {
        status: "loading";
      }
    | {
        status: "error";
        errors: {
          message: string;
          patchId?: PatchId;
          skipped?: boolean;
        }[];
      }
  >;
  patchesStatus: Record<
    SourcePath,
    | {
        status: "created-patch";
        createdAt: string;
      }
    | {
        status: "uploading-patch";
        createdAt: string;
        updatedAt: string;
      }
    | {
        status: "error";
        errors: {
          message: string;
          patchId?: PatchId;
          skipped?: boolean;
        }[];
      }
  >;
  patchIds: PatchId[];
  profiles: Record<AuthorId, Profile>;
  deployments: Deployment[];
  dismissDeployment: (deploymentId: string) => void;
};
const ValContext = React.createContext<ValContextValue>(
  new Proxy(
    {},
    {
      get: () => {
        throw new Error("Cannot use ValContext outside of ValProvider");
      },
    },
  ) as ValContextValue,
);

export function ValProvider({
  children,
  client,
  dispatchValEvents,
}: {
  children: React.ReactNode;
  client: ValClient;
  dispatchValEvents: boolean;
}) {
  const {
    addPatch,
    deletePatches,
    authenticationState,
    schemas,
    schemaSha,
    stat,
    sources,
    validationErrors,
    sourcesSyncStatus,
    patchesStatus,
    patchIds,
    serviceUnavailable,
  } = useValState(client, dispatchValEvents);
  const [profiles, setProfiles] = useState<Record<AuthorId, Profile>>({});
  useEffect(() => {
    const load = async () => {
      const res = await client("/profiles", "GET", {});
      if (res.status === 200) {
        const profilesById: Record<AuthorId, Profile> = {};
        for (const profile of res.json.profiles) {
          profilesById[profile.profileId] = {
            fullName: profile.fullName,
            avatar: profile.avatar,
          };
        }
        setProfiles(profilesById);
      } else {
        console.error("Could not get profiles", res.json);
      }
    };
    load();
  }, ["data" in stat && stat.data && stat.data.baseSha]);

  // Global debounce: to avoid canceling patches that are debounced on navigation
  const debouncedPatches = useRef<Record<SourcePath, (() => Patch)[]>>({});
  useEffect(() => {
    setInterval(() => {
      if (Object.keys(debouncedPatches.current).length === 0) {
        return;
      }
      for (const [pathS, patches] of Object.entries(debouncedPatches.current)) {
        const path = pathS as SourcePath;
        const [moduleFilePath] =
          Internal.splitModuleFilePathAndModulePath(path);
        for (const getPatch of patches) {
          addPatch(moduleFilePath, getPatch());
        }
      }
      debouncedPatches.current = {};
    }, 200);
  }, [addPatch]);
  const addDebouncedPatch = useCallback(
    (get: () => Patch, path: SourcePath) => {
      if (!debouncedPatches.current[path]) {
        debouncedPatches.current[path] = [];
      }
      debouncedPatches.current[path].push(get);
    },
    [],
  );
  const config =
    "data" in stat && stat.data ? (stat.data.config as ValConfig) : undefined;
  const configError = "error" in stat ? stat.error : undefined;

  const [showServiceUnavailable, setShowServiceUnavailable] = useState<
    boolean | undefined
  >();
  useEffect(() => {
    // only show service unavailable if it is false at init
    if (
      showServiceUnavailable === undefined ||
      showServiceUnavailable === true
    ) {
      if (serviceUnavailable) {
        const timeout = setTimeout(() => {
          setShowServiceUnavailable(serviceUnavailable);
        }, 2000);
        return () => {
          clearTimeout(timeout);
        };
      } else if (!serviceUnavailable) {
        setShowServiceUnavailable(false);
      }
    }
  }, [serviceUnavailable, showServiceUnavailable]);

  const [theme, setTheme] = useState<Themes | null>(null);
  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem(
        "val-theme-" + (config?.project || "unknown"),
      );
      if (storedTheme) {
        if (storedTheme === "light" || storedTheme === "dark") {
          setTheme(storedTheme);
        } else {
          throw new Error(`Invalid Val theme: ${storedTheme}`);
        }
      } else if (configError) {
        setTheme("dark");
      }
    } catch (e) {
      console.error("Error getting theme from local storage", e);
    }
  }, [config, configError]);
  useEffect(() => {
    if (config?.defaultTheme && theme === null) {
      if (config?.defaultTheme === "dark" || config?.defaultTheme === "light") {
        setTheme(config.defaultTheme);
      } else {
        console.warn(`Invalid config default theme: ${config.defaultTheme}`);
      }
    } else if (config !== undefined && theme === null) {
      setTheme("dark");
    }
  }, [theme, config]);

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [currentRequestSummary, setCurrentRequestSummary] = useState<{
    baseSha: string | undefined;
    patchIdsString: string;
    commitSummary: string | null;
  } | null>(null);
  const publish = useCallback(() => {
    setIsPublishing(true);
    client("/save", "POST", {
      body: {
        message: currentRequestSummary?.commitSummary ?? undefined,
        patchIds,
      },
    })
      .then((res) => {
        if (res.status === 200) {
          setIsPublishing(false);
          setPublishError(null);
        } else {
          console.error("Error publishing", res.json);
          setPublishError(res.json.message);
          setIsPublishing(false);
        }
      })
      .catch((err) => {
        setPublishError(err.message);
        setIsPublishing(false);
      });
  }, [client, patchIds]);
  const resetPublishError = useCallback(() => {
    setPublishError(null);
  }, []);
  const getPatches = useCallback(
    async (patchIds: PatchId[]): Promise<GetPatchRes> => {
      const res = await client("/patches", "GET", {
        query: {
          exclude_patch_ops: false,
          patch_id: patchIds,
        },
      });
      if (res.status === 200) {
        const grouped: GroupedPatches = {};
        for (const patch of res.json.patches) {
          grouped[patch.patchId] = patch;
        }
        return { status: "ok", data: grouped } as const;
      }
      return { status: "error", error: res.json.message } as const;
    },
    [client],
  );
  const portalRef = useRef<HTMLDivElement>(null);
  const baseSha = "data" in stat && stat.data ? stat.data.baseSha : undefined;
  const getCommitSummary = useCallback(async () => {
    const patchIdsString = patchIds.join(",");
    if (
      currentRequestSummary &&
      baseSha === currentRequestSummary.baseSha &&
      patchIdsString === currentRequestSummary.patchIdsString
    ) {
      return {
        commitSummary: currentRequestSummary.commitSummary,
      };
    }
    const res = await client("/commit-summary", "GET", {
      query: {
        patch_id: patchIds,
      },
    });
    if (res.status === 200) {
      setCurrentRequestSummary({
        baseSha,
        patchIdsString,
        commitSummary: res.json.commitSummary,
      });
      return {
        commitSummary: res.json.commitSummary,
      };
    }
    return { error: res.json.message };
  }, [client, baseSha, patchIds]);

  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const dismissedDeploymentsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if ("data" in stat && stat.data) {
      if (stat.data?.deployments) {
        setDeployments((prev) => {
          if (stat.data?.deployments && stat.data?.deployments?.length > 0) {
            const grouped: Record<string, Deployment> = {};
            for (const d of stat.data.deployments) {
              if (dismissedDeploymentsRef.current.has(d.deployment_id)) {
                continue;
              }
              if (!grouped[d.deployment_id]) {
                grouped[d.deployment_id] = {
                  deploymentId: d.deployment_id,
                  deploymentState:
                    d.deployment_state as Deployment["deploymentState"],
                  createdAt: d.created_at,
                  updatedAt: d.updated_at,
                };
              }
              if (d.updated_at > grouped[d.deployment_id].updatedAt) {
                grouped[d.deployment_id].updatedAt = d.updated_at;
                grouped[d.deployment_id].deploymentState =
                  d.deployment_state as Deployment["deploymentState"];
              }
            }
            const newDeployments = Object.values(grouped).sort((a, b) => {
              return a.updatedAt > b.updatedAt ? -1 : 1;
            });
            return newDeployments;
          }
          return prev;
        });
      }
    }
  }, ["data" in stat && stat.data]);
  const dismissDeployment = useCallback((deploymentId: string) => {
    setDeployments((prev) => {
      return prev.filter((d) => d.deploymentId !== deploymentId);
    });
    dismissedDeploymentsRef.current.add(deploymentId);
  }, []);

  return (
    <ValContext.Provider
      value={{
        mode: "data" in stat && stat.data ? stat.data.mode : "unknown",
        serviceUnavailable: showServiceUnavailable,
        baseSha,
        deployments,
        dismissDeployment,
        getCommitSummary,
        portalRef: portalRef.current,
        authenticationState,
        addPatch,
        getPatches,
        deletePatches,
        addDebouncedPatch,
        theme,
        setTheme: (theme) => {
          if (theme === "dark" || theme === "light") {
            try {
              localStorage.setItem(
                "val-theme-" + (config?.project || "unknown"),
                theme,
              );
              localStorage.setItem("val-theme-unknown", theme);
            } catch (e) {
              console.error("Error setting theme in local storage", e);
            }
            setTheme(theme);
          } else {
            console.warn(`Cannot set invalid theme theme: ${theme}`);
          }
        },
        publish,
        isPublishing,
        publishError,
        resetPublishError,
        config,
        schemas,
        schemaSha,
        sources,
        validationErrors,
        sourcesSyncStatus,
        patchesStatus,
        patchIds,
        profiles,
      }}
    >
      <DayPickerProvider
        initialProps={{
          mode: "default",
        }}
      >
        <div
          data-val-portal="true"
          ref={portalRef}
          {...(theme ? { "data-mode": theme } : {})}
        ></div>
        {children}
      </DayPickerProvider>
    </ValContext.Provider>
  );
}

export function useValPortal() {
  return useContext(ValContext).portalRef;
}

export type Themes = "dark" | "light";

export function useTheme() {
  const { theme, setTheme } = useContext(ValContext);
  return { theme, setTheme };
}

export function useValConfig() {
  const { config } = useContext(ValContext);
  const lastConfig = useRef<ValConfig | undefined>(config);
  useEffect(() => {
    if (config) {
      lastConfig.current = config;
    }
  }, [config]);
  return lastConfig.current;
}

export function useAuthenticationState() {
  const { authenticationState } = useContext(ValContext);
  return authenticationState;
}

export function useConnectionStatus() {
  const { serviceUnavailable } = useContext(ValContext);
  return serviceUnavailable === true ? "service-unavailable" : "connected";
}

export function useAddPatch(sourcePath: SourcePath) {
  const { addPatch, addDebouncedPatch } = useContext(ValContext);
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const patchPath = useMemo(() => {
    return Internal.createPatchPath(modulePath);
  }, [modulePath]);
  const addPatchCallback = useCallback(
    (patch: Patch) => {
      addPatch(moduleFilePath, patch);
    },
    [addPatch, sourcePath],
  );

  return {
    patchPath,
    addPatch: addPatchCallback,
    /**
     * Prefer addPatch. Use addModuleFilePatch only if you need to add a patch to a different module file (should be rare).
     */
    addModuleFilePatch: addPatch,
    addDebouncedPatch,
  };
}

export function useDeletePatches() {
  const { deletePatches } = useContext(ValContext);
  return { deletePatches };
}

export function useGetPatches() {
  const { getPatches } = useContext(ValContext);
  return { getPatches };
}

export function useDeployments() {
  const { deployments, dismissDeployment } = useContext(ValContext);
  return { deployments, dismissDeployment };
}

export function useAppliedPatches() {
  const { getPatches } = useGetPatches();
  const { isPublishing, patchIds } = useContext(ValContext);
  const [appliedPatchIds, setAppliedPatchIds] = useState<Set<PatchId>>(
    new Set(),
  );
  useEffect(() => {
    if (!isPublishing) {
      getPatches(patchIds).then((res) => {
        if (res.status === "ok") {
          const appliedPatchIds = new Set<PatchId>();
          for (const [patchIdS, patchMetadata] of Object.entries(res.data)) {
            // TODO: as long as appliedAt is set, I suppose we can assume it is applied for this current commit?
            if (patchMetadata?.appliedAt) {
              appliedPatchIds.add(patchIdS as PatchId);
            }
          }
          setAppliedPatchIds(appliedPatchIds);
        }
      });
    } else {
      setAppliedPatchIds(new Set(patchIds));
    }
  }, [isPublishing, patchIds.join(",")]);
  return appliedPatchIds;
}

export function useCurrentPatchIds(): PatchId[] {
  const { patchIds } = useContext(ValContext);
  return patchIds;
}

export function useValMode(): "http" | "fs" | "unknown" {
  const { mode } = useContext(ValContext);
  return mode;
}

export function useSummary() {
  const { getCommitSummary } = useContext(ValContext);

  return {
    getCommitSummary,
  };
}

export type LoadingStatus = "loading" | "not-asked" | "error" | "success";
export function useLoadingStatus(): LoadingStatus {
  const { sourcesSyncStatus } = useContext(ValContext);
  return useMemo(() => {
    if (
      Object.values(sourcesSyncStatus).some(
        (status) => status.status === "loading",
      )
    ) {
      return "loading";
    }
    if (
      Object.values(sourcesSyncStatus).some(
        (status) => status.status === "error",
      )
    ) {
      return "error";
    }
    return "success";
  }, [sourcesSyncStatus]);
}

export function useSyncStatus() {
  const { sourcesSyncStatus } = useContext(ValContext);
  return sourcesSyncStatus;
}

export function usePublish() {
  const { publish, isPublishing, publishError, resetPublishError } =
    useContext(ValContext);
  const patchIds = useCurrentPatchIds();
  const { globalErrors } = useErrors();
  const debouncedLoadingStatus = useDebouncedLoadingStatus();
  const appliedPatchIds = useAppliedPatches();
  const unappliedPatchIds = patchIds.filter(
    (patchId) => !appliedPatchIds.has(patchId),
  );
  const publishDisabled =
    debouncedLoadingStatus !== "success" ||
    isPublishing ||
    unappliedPatchIds.length === 0 ||
    globalErrors.length > 0;
  return {
    publish,
    isPublishing,
    publishError,
    resetPublishError,
    publishDisabled,
  };
}

export function useDebouncedLoadingStatus() {
  const syncStatus = useSyncStatus();
  // Debounce loading status to avoid flickering...
  const [debouncedLoadingStatus, setDebouncedLoadingStatus] = useState<
    "loading" | "error" | "success" | "not-asked"
  >("not-asked");
  useEffect(() => {
    let loadingStatus: "loading" | "error" | "success" = "success";
    for (const value of Object.values(syncStatus)) {
      if (value.status === "error") {
        loadingStatus = "error";
        break;
      } else if (value.status === "loading") {
        loadingStatus = "loading";
        break;
      }
    }
    if (loadingStatus === "success") {
      const timeout = setTimeout(() => {
        setDebouncedLoadingStatus(loadingStatus);
      }, 100);
      return () => {
        clearTimeout(timeout);
      };
    } else {
      setDebouncedLoadingStatus(loadingStatus);
    }
  }, [syncStatus]);
  return debouncedLoadingStatus;
}

type EnsureAllTypes<T extends Record<SerializedSchema["type"], unknown>> = T;
/**
 * A shallow source is the source that is just enough to render each type of schema.
 * For example, if the schema is an object, the shallow source will contain the keys of the object and the source paths to the values below.
 * Primitive values are complete, but shallow source guarantees does only a minimum amount of validation:
 * object with _ref for files and images, string is a string, richtext is an array, etc.
 *
 * The sources must be validated properly to ensure that the source is indeed correct.
 *
 * The general idea is to avoid re-rendering the entire source tree when a single value changes.
 */
export type ShallowSource = EnsureAllTypes<{
  array: SourcePath[];
  object: Record<string, SourcePath>;
  record: Record<string, SourcePath>;
  union: string | Record<string, SourcePath>;
  boolean: boolean;
  keyOf: string;
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
}>;

export function useSchemaAtPath(sourcePath: SourcePath) {
  const { schemas, sources } = useContext(ValContext);
  const getMemoizedResolvedSchema = useCallback(():
    | { status: "not-found" }
    | { status: "loading" }
    | {
        status: "success";
        data: SerializedSchema;
      }
    | {
        status: "error";
        error: string;
      } => {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath);
    const moduleSources = sources[moduleFilePath];
    if (schemas.status === "error") {
      return schemas;
    } else if (schemas.status === "not-asked") {
      return { status: "loading" };
    } else if (schemas.status === "loading") {
      return { status: "loading" };
    } else if (moduleSources === undefined) {
      return { status: "not-found" };
    }
    const moduleSchema = schemas.data[moduleFilePath];
    try {
      const { schema } = Internal.resolvePath(
        modulePath,
        moduleSources,
        moduleSchema,
      );
      if (schema === undefined) {
        return { status: "not-found" };
      }
      return {
        status: "success",
        data: schema,
      };
    } catch (e) {
      return {
        status: "error",
        error:
          e instanceof Error
            ? e.message
            : "Unknown error: " + JSON.stringify(e),
      };
    }
  }, [sourcePath, sources, schemas]);

  return useMemo(getMemoizedResolvedSchema, [
    // NOTE: we avoid depending on sources directly, and depend on the shallowSource to avoid unnecessary re-renders
    // TODO: optimize re-renders:
    // shallowSource, // Not sure if this helps
    sources,
    sourcePath,
    schemas,
  ]);
}

export function useSchemas() {
  return useContext(ValContext).schemas;
}

export function useSchemaSha() {
  return useContext(ValContext).schemaSha;
}

export function useErrors() {
  // sync errors, schema errors, patch errors, validation errors
  const { sourcesSyncStatus, schemas, patchesStatus, validationErrors } =
    useContext(ValContext);
  const globalErrors: string[] = [];
  const patchErrors: Record<PatchId, string[]> = {};
  const skippedPatches: Record<PatchId, true> = {};
  if (schemas.status === "error") {
    globalErrors.push(schemas.error);
  }

  for (const [moduleFilePath, value] of Object.entries(sourcesSyncStatus)) {
    if (value.status === "error") {
      for (const error of value.errors) {
        if (error.patchId) {
          if (error.skipped) {
            skippedPatches[error.patchId] = true;
          }
          if (!patchErrors[error.patchId]) {
            patchErrors[error.patchId] = [];
          }
          patchErrors[error.patchId].push(error.message);
        } else {
          globalErrors.push(
            `Error syncing ${moduleFilePath}: ${error.message}`,
          );
        }
      }
    }
  }

  for (const [sourcePath, errors] of Object.entries(validationErrors)) {
    for (const error of errors) {
      globalErrors.push(`Error validating ${sourcePath}: ${error.message}`);
    }
  }
  for (const [sourcePathS, value] of Object.entries(patchesStatus)) {
    const sourcePath = sourcePathS as SourcePath;
    if (value.status === "error") {
      for (const error of value.errors) {
        if (error.patchId) {
          if (error.skipped) {
            skippedPatches[error.patchId] = true;
          }
          if (!patchErrors[error.patchId]) {
            patchErrors[error.patchId] = [];
          }
          patchErrors[error.patchId].push(error.message);
        } else {
          globalErrors.push(`Error patching ${sourcePath}: ${error.message}`);
        }
      }
    }
  }

  return { globalErrors, patchErrors, skippedPatches, validationErrors };
}

export function useProfilesByAuthorId() {
  const { profiles } = useContext(ValContext);
  return profiles;
}

type ShallowSourceOf<SchemaType extends SerializedSchema["type"]> =
  | { status: "not-found" }
  | {
      status: "success";
      data: ShallowSource[SchemaType] | null; // we add union to allow for nullable values
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

/**
 * A shallow source is the source that is just enough to render each type of schema.
 * @see ShallowSource for more information.
 *
 * The general idea is to avoid re-rendering the entire source tree when a single value changes.
 */
export function useShallowSourceAtPath<
  SchemaType extends SerializedSchema["type"],
>(sourcePath?: SourcePath, type?: SchemaType): ShallowSourceOf<SchemaType> {
  const { sources, sourcesSyncStatus } = useContext(ValContext);
  if (sourcePath === undefined) {
    return { status: "loading" };
  }
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const source = useMemo((): ShallowSourceOf<SchemaType> => {
    const moduleSources = sources[moduleFilePath];
    if (moduleSources !== undefined && type !== undefined) {
      const sourceAtSourcePath = getShallowSourceAtSourcePath(
        moduleFilePath,
        modulePath,
        type,
        moduleSources,
      );
      return sourceAtSourcePath;
    } else {
      return { status: "not-found" };
    }
  }, [sources[moduleFilePath], sourcePath, type]);

  const status = useMemo(() => {
    return sourcesSyncStatus[moduleFilePath];
  }, [moduleFilePath, sourcesSyncStatus]);
  if ("data" in source && status?.status === "loading") {
    return { status: "loading", data: source.data };
  }
  if (status?.status === "error") {
    return {
      status: "error",
      data: "data" in source ? source.data : undefined,
      error: status.errors.map((error) => error.message).join(", "),
    };
  }
  return source;
}

/**
 * Avoid using this unless necessary. Prefer useSourceAtPath or useShallowSourceAtPath instead.
 * Reason: principles! Use only what you need...
 */
export function useSources() {
  return useContext(ValContext).sources;
}

export function useSourceAtPath(sourcePath: SourcePath) {
  const { sources } = useContext(ValContext);

  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  return walkSourcePath(modulePath, sources[moduleFilePath]);
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
    // We allow null at the leaf node, but NOT in the middle of the path
    if (source === null) {
      return {
        status: "error",
        error: `Expected object at ${modulePath}, got null`,
      };
    }
    // We never allow undefined
    if (source === undefined) {
      return {
        status: "error",
        error: `Expected object at ${modulePath}, got undefined`,
      };
    }
    // Since the source path is not at the end leaf node, we expect an object / array.
    if (typeof source !== "object") {
      return {
        status: "error",
        error: `Expected object at ${modulePath}, got ${JSON.stringify(source)}`,
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
  // We never allow undefined
  if (source === undefined) {
    return {
      status: "error",
      error: `Expected object at ${modulePath}, got undefined`,
    };
  }
  return { status: "success", data: source };
}

function getShallowSourceAtSourcePath<
  SchemaType extends SerializedSchema["type"],
>(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
  type: SchemaType,
  sources: Json,
): ShallowSourceOf<SchemaType> {
  const source = walkSourcePath(modulePath, sources);
  if ("data" in source && source.data !== undefined) {
    const mappedSource = mapSource(
      moduleFilePath,
      modulePath,
      type,
      source.data,
    );
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
        error: `Expected string, got ${typeof source}: ${JSON.stringify(source)}`,
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
      source.metatadata &&
      typeof source.metatadata !== "object"
    ) {
      return {
        status: "error",
        error: `Expected metadata of ${type} to be an object, got ${typeof source.metadata}`,
      };
    }
    // TODO: verify that metadata values is of type Json
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

type GroupedPatches = Record<
  PatchId,
  {
    path: ModuleFilePath;
    createdAt: string;
    authorId: string | null;
    patch?: Patch | undefined;
    appliedAt: {
      commitSha: string;
    } | null;
  }
>;
type GetPatchRes =
  | {
      status: "ok";
      data: Partial<GroupedPatches>;
    }
  | {
      status: "error";
      error: string;
    };

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

type AuthorId = string;
export type Profile = {
  fullName: string;
  avatar: {
    url: string;
  } | null;
};

export type Deployment = {
  deploymentId: string;
  deploymentState: "pending" | "success" | "failure" | "error" | "created";
  createdAt: string;
  updatedAt: string;
};
