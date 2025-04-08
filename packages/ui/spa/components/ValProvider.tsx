import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
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
import { Patch } from "@valbuild/core/patch";
import { ValClient } from "@valbuild/shared/internal";
import { isJsonArray } from "../utils/isJsonArray";
import { DayPickerProvider } from "react-day-picker";
import { AuthenticationState, useStatus } from "../hooks/useStatus";
import { findRequiredRemoteFiles } from "../utils/findRequiredRemoteFiles";
import { defaultOverlayEmitter, ValSyncStore } from "../ValSyncStore";
import { SerializedPatchSet } from "../utils/PatchSets";

type ValContextValue = {
  syncStore: ValSyncStore;
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
  addPatch: (
    moduleFilePath: ModuleFilePath,
    patch: Patch,
    type: SerializedSchema["type"],
  ) =>
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
      };
  getPatches: (patchIds: PatchId[]) => Promise<GetPatchRes>;
  deletePatches: (patchIds: PatchId[]) => void;
  publish: () => void;
  isPublishing: boolean;
  publishError: string | null;
  resetPublishError: () => void;
  profiles: Record<AuthorId, Profile>;
  deployments: Deployment[];
  dismissDeployment: (deploymentId: string) => void;
  remoteFiles:
    | {
        status: "ready";
        publicProjectId: string;
        coreVersion: string;
        buckets: string[];
      }
    | {
        status: "loading" | "not-asked";
      }
    | {
        status: "inactive";
        reason:
          | "unknown-error"
          | "project-not-configured"
          | "api-key-missing"
          | "pat-error"
          | "error-could-not-get-settings"
          | "no-internet-connection"
          | "unauthorized-personal-access-token-error"
          | "unauthorized";
      };
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
  const [
    stat,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _setStat,
    authenticationState,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setAuthenticationLoadingIfNotAuthenticated,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setIsAuthenticated,
    serviceUnavailable,
  ] = useStatus(client);
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

  const syncStore = useMemo(
    () =>
      new ValSyncStore(client, (moduleFilePath, newSource) => {
        if (dispatchValEvents) {
          defaultOverlayEmitter(moduleFilePath, newSource);
        }
      }),
    [dispatchValEvents],
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
    if (syncStore.globalServerSidePatchIds === null) {
      return;
    }
    setIsPublishing(true);
    client("/save", "POST", {
      body: {
        message: currentRequestSummary?.commitSummary ?? undefined,
        patchIds: syncStore.globalServerSidePatchIds ?? [],
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
  }, [client, syncStore]);
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
    if (syncStore.globalServerSidePatchIds === null) {
      return { commitSummary: null };
    }
    const patchIdsString = syncStore.globalServerSidePatchIds.join(",");
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
        patch_id: syncStore.globalServerSidePatchIds,
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
  }, [client, baseSha, syncStore.globalServerSidePatchIds]);

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

  const [remoteFiles, setRemoteFiles] = useState<
    ValContextValue["remoteFiles"]
  >({
    status: "not-asked",
  });
  const [requiresRemoteFiles, setRequiresRemoteFiles] = useState(false);
  useEffect(() => {
    if (syncStore.schemas) {
      const schemasData = syncStore.schemas;
      let requiresRemoteFiles = false;
      for (const schema of Object.values(schemasData)) {
        if (findRequiredRemoteFiles(schema)) {
          requiresRemoteFiles = true;
          break;
        }
      }
      setRequiresRemoteFiles(requiresRemoteFiles);
    }
  }, [syncStore.schemas]);
  useEffect(() => {
    let retries = 0;
    function loadRemoteSettings() {
      retries++;
      if (remoteFiles.status !== "ready" && retries < 10) {
        client("/remote/settings", "GET", {})
          .then((res) => {
            if (res.status === 200) {
              setRemoteFiles({
                status: "ready",
                coreVersion: res.json.coreVersion,
                buckets: res.json.remoteFileBuckets.map(
                  (bucket) => bucket.bucket,
                ),
                publicProjectId: res.json.publicProjectId,
              });
            } else {
              if ("errorCode" in res.json && res.json.errorCode) {
                setRemoteFiles({
                  status: "inactive",
                  reason: res.json.errorCode,
                });
              } else {
                setRemoteFiles({
                  status: "inactive",
                  reason: "unknown-error",
                });
              }
              setTimeout(loadRemoteSettings, 5000);
            }
          })
          .catch((err) => {
            console.error("Error getting remote settings", err);
            setRemoteFiles({ status: "inactive", reason: "unknown-error" });
            setTimeout(loadRemoteSettings, 5000);
          });
      }
    }
    if (requiresRemoteFiles) {
      setRemoteFiles({ status: "loading" });
      loadRemoteSettings();
    }
  }, [requiresRemoteFiles]);

  const syncStoreInitStatus = useRef<
    "not-asked" | "done" | "in-progress" | "retry"
  >("not-asked");
  const [startSyncPoll, setStartSyncPoll] = useState(false);

  useEffect(() => {
    if (
      "data" in stat &&
      stat.data &&
      syncStoreInitStatus.current === "not-asked"
    ) {
      syncStoreInitStatus.current = "in-progress";
      let timeout: NodeJS.Timeout | null = null;
      const exec = async () => {
        if ("data" in stat && stat.data) {
          const res = await syncStore.init(
            stat.data.baseSha,
            stat.data.schemaSha,
            stat.data.patches,
            stat.data.profileId,
            Date.now(),
          );
          if (res.status === "retry") {
            syncStoreInitStatus.current = "retry";
            timeout = setTimeout(exec, 4000);
          } else {
            console.log("Val is initialized!");
            syncStoreInitStatus.current = "done";
            if (timeout) {
              clearTimeout(timeout);
            }
            setStartSyncPoll(true);
          }
        } else {
          throw Error(
            "Unexpected state: init was started with start.data but now it is not there",
          );
        }
      };
      exec();
      return () => {
        if (timeout) {
          clearTimeout(timeout);
        }
      };
    } else if ("data" in stat && stat.data) {
      syncStore.syncWithUpdatedStat(
        stat.data.baseSha,
        stat.data.schemaSha,
        stat.data.patches,
        Date.now(),
      );
    }
  }, [stat, syncStore]);
  useEffect(() => {
    if (!startSyncPoll) {
      return;
    }
    let timeout: NodeJS.Timeout | null = null;
    const sync = async () => {
      await syncStore.sync(Date.now());
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(sync, 1000);
    };
    sync();
    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [syncStore, startSyncPoll]);

  return (
    <ValContext.Provider
      value={{
        syncStore,
        mode: "data" in stat && stat.data ? stat.data.mode : "unknown",
        serviceUnavailable: showServiceUnavailable,
        baseSha,
        deployments,
        dismissDeployment,
        getCommitSummary,
        portalRef: portalRef.current,
        authenticationState,
        getPatches,
        addPatch: (moduleFilePath, patch, type) => {
          return syncStore.addPatch(moduleFilePath, type, patch, Date.now());
        },
        deletePatches: (patchIds) => {
          // Delete in batches of 100 patch ids (since it is added to request url as query param)
          const batches = [];
          for (let i = 0; i < patchIds.length; i += 100) {
            batches.push(patchIds.slice(i, i + 100));
          }
          for (const batch of batches) {
            syncStore.deletePatches(batch, Date.now());
          }
        },
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
        profiles,
        remoteFiles,
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
  const lastConfig = useRef<
    | (ValConfig & {
        remoteHost: string;
      })
    | undefined
  >(
    config && {
      ...config,
      remoteHost: DEFAULT_VAL_REMOTE_HOST,
    },
  );
  useEffect(() => {
    if (config) {
      lastConfig.current = {
        ...config,
        remoteHost: DEFAULT_VAL_REMOTE_HOST,
      };
    }
  }, [config]);
  return lastConfig.current;
}

export function useRemoteFiles() {
  const { remoteFiles } = useContext(ValContext);
  return remoteFiles;
}

export function useCurrentRemoteFileBucket() {
  const { remoteFiles } = useContext(ValContext);
  const [currentBucket, setCurrentBucket] = useState<string | null>(null);

  function getRandomInt(max: number) {
    return Math.floor(Math.random() * max);
  }

  useEffect(() => {
    if (
      remoteFiles.status === "ready" &&
      remoteFiles.buckets.length > 0 &&
      currentBucket === null
    ) {
      // Ideally we do round robin, but for now, we just pick a random bucket
      setCurrentBucket(
        remoteFiles.buckets[getRandomInt(remoteFiles.buckets.length)],
      );
    }
  }, [remoteFiles]);
  return currentBucket;
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
  const { addPatch } = useContext(ValContext);
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const patchPath = useMemo(() => {
    return Internal.createPatchPath(modulePath);
  }, [modulePath]);
  const addPatchCallback = useCallback(
    (patch: Patch, type: SerializedSchema["type"]) => {
      addPatch(moduleFilePath, patch, type);
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
  };
}

export function useDeletePatches() {
  const { deletePatches } = useContext(ValContext);
  return { deletePatches };
}

export function useDeployments() {
  const { deployments, dismissDeployment } = useContext(ValContext);
  return { deployments, dismissDeployment };
}

export function usePatchSets():
  | {
      status: "success";
      data: SerializedPatchSet;
    }
  | {
      status: "error";
      error: string;
    }
  | {
      status: "not-asked";
    } {
  const { syncStore } = useContext(ValContext);
  const serializedPatchSets = useSyncExternalStore(
    syncStore.subscribe("patch-sets"),
    () => syncStore.getSerializedPatchSetsSnapshot(),
    () => syncStore.getSerializedPatchSetsSnapshot(),
  );
  return { status: "success", data: serializedPatchSets };
}

export function usePublishedPatches() {
  // const { getPatches } = useGetPatches();
  const { isPublishing, syncStore } = useContext(ValContext);
  const patchIds = syncStore.globalServerSidePatchIds ?? [];
  const [appliedPatchIds, setAppliedPatchIds] = useState<Set<PatchId>>(
    new Set(),
  );
  // useEffect(() => {
  //   if (!isPublishing) {
  //     getPatches(patchIds).then((res) => {
  //       if (res.status === "ok") {
  //         const appliedPatchIds = new Set<PatchId>();
  //         for (const [patchIdS, patchMetadata] of Object.entries(res.data)) {
  //           // TODO: as long as appliedAt is set, I suppose we can assume it is applied for this current commit?
  //           if (patchMetadata?.appliedAt) {
  //             appliedPatchIds.add(patchIdS as PatchId);
  //           }
  //         }
  //         setAppliedPatchIds(appliedPatchIds);
  //       }
  //     });
  //   } else {
  //     setAppliedPatchIds(new Set(patchIds));
  //   }
  // }, [isPublishing, patchIds.join(",")]);
  return appliedPatchIds;
}

export function useCurrentPatchIds(): PatchId[] {
  const { syncStore } = useContext(ValContext);
  return syncStore.globalServerSidePatchIds ?? [];
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
  const { syncStore } = useContext(ValContext);
  if (syncStore.initializedAt === null) {
    return "not-asked";
  }
  if (syncStore.pendingOps.length > 0) {
    return "loading";
  }
  return "success";
}

export function usePublish() {
  const { publish, isPublishing, publishError, resetPublishError } =
    useContext(ValContext);
  const patchIds = useCurrentPatchIds();
  const { globalErrors } = useErrors();
  const debouncedLoadingStatus = useDebouncedLoadingStatus();
  const publishedPatchIds = usePublishedPatches();
  const unappliedPatchIds = patchIds.filter(
    (patchId) => !publishedPatchIds.has(patchId),
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
  // TODO: remove this?
  return useLoadingStatus();
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

export function useSchemaAtPath(sourcePath: SourcePath):
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
  const { syncStore } = useContext(ValContext);
  const data = useSyncExternalStore(
    syncStore.subscribe("schema"),
    () => syncStore.getDataSnapshot(sourcePath),
    () => syncStore.getDataSnapshot(sourcePath),
  );
  if (data.status === "success") {
    return { status: "success", data: data.data.schema };
  }
  if (syncStore.initializedAt === null) {
    return { status: "loading" };
  }
  if (data.status === "module-schema-not-found") {
    return { status: "not-found" };
  }
  if (data.status === "module-source-not-found") {
    return { status: "not-found" };
  }
  return { status: "error", error: data.message || data.status };
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
  const syncStore = useContext(ValContext).syncStore;
  if (syncStore.initializedAt === null) {
    return { status: "loading" } as const;
  }
  if (syncStore.schemas === null) {
    return {
      status: "error",
      error: "Schemas not found",
    } as const;
  }
  return {
    status: "success",
    data: syncStore.schemas || {},
  } as const;
}

export function useSchemaSha() {
  return useContext(ValContext).syncStore.clientSideSchemaSha;
}

export function useValidationErrors(sourcePath: SourcePath) {
  const { syncStore } = useContext(ValContext);
  const data = useSyncExternalStore(
    syncStore.subscribe("validation-error", sourcePath),
    () => syncStore.getValidationErrorSnapshot(sourcePath),
    () => syncStore.getValidationErrorSnapshot(sourcePath),
  );
  return data || [];
}
export function useAllValidationErrors() {
  const { syncStore } = useContext(ValContext);
  const validationErrors = useSyncExternalStore(
    syncStore.subscribe("all-validation-errors"),
    () => syncStore.getAllValidationErrorsSnapshot(),
    () => syncStore.getAllValidationErrorsSnapshot(),
  );
  return validationErrors;
}

export function useErrors() {
  const globalErrors: string[] = [];
  const patchErrors: Record<PatchId, string[]> = {};
  const skippedPatches: Record<PatchId, true> = {};

  // if (schemas.status === "error") {
  //   globalErrors.push(schemas.error);
  // }

  // for (const [moduleFilePath, value] of Object.entries(sourcesSyncStatus)) {
  //   if (value.status === "error") {
  //     for (const error of value.errors) {
  //       if (error.patchId) {
  //         if (error.skipped) {
  //           skippedPatches[error.patchId] = true;
  //         }
  //         if (!patchErrors[error.patchId]) {
  //           patchErrors[error.patchId] = [];
  //         }
  //         patchErrors[error.patchId].push(error.message);
  //       } else {
  //         globalErrors.push(
  //           `Error syncing ${moduleFilePath}: ${error.message}`,
  //         );
  //       }
  //     }
  //   }
  // }

  // for (const [sourcePath, errors] of Object.entries(validationErrors)) {
  //   for (const error of errors) {
  //     globalErrors.push(`Error validating ${sourcePath}: ${error.message}`);
  //   }
  // }
  // for (const [sourcePathS, value] of Object.entries(patchesStatus)) {
  //   const sourcePath = sourcePathS as SourcePath;
  //   if (value.status === "error") {
  //     for (const error of value.errors) {
  //       if (error.patchId) {
  //         if (error.skipped) {
  //           skippedPatches[error.patchId] = true;
  //         }
  //         if (!patchErrors[error.patchId]) {
  //           patchErrors[error.patchId] = [];
  //         }
  //         patchErrors[error.patchId].push(error.message);
  //       } else {
  //         globalErrors.push(`Error patching ${sourcePath}: ${error.message}`);
  //       }
  //     }
  //   }
  // }

  return { globalErrors, patchErrors, skippedPatches };
}

export function useProfilesByAuthorId() {
  const { profiles } = useContext(ValContext);
  return profiles;
}

type ShallowSourceOf<SchemaType extends SerializedSchema["type"]> =
  | { status: "not-found" }
  | {
      status: "success";
      clientSideOnly: boolean;
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
  const { syncStore } = useContext(ValContext);
  const [moduleFilePath, modulePath] = sourcePath
    ? Internal.splitModuleFilePathAndModulePath(sourcePath)
    : (["", ""] as [ModuleFilePath, ModulePath]);
  const sourcesRes = useSyncExternalStore(
    syncStore.subscribe("source", moduleFilePath),
    () => syncStore.getDataSnapshot(moduleFilePath),
    () => syncStore.getDataSnapshot(moduleFilePath),
  );

  const source = useMemo((): ShallowSourceOf<SchemaType> => {
    if (syncStore.initializedAt === null) {
      return { status: "loading" };
    }
    if (moduleFilePath === "") {
      return { status: "loading" };
    }
    if (sourcesRes.status === "module-schema-not-found") {
      return { status: "not-found" };
    }
    if (sourcesRes.status === "module-source-not-found") {
      return { status: "not-found" };
    }
    if (sourcesRes.status === "success") {
      const moduleSources = sourcesRes.data.source;
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
  }, [
    sourcesRes,
    modulePath,
    moduleFilePath,
    syncStore.initializedAt,
    syncStore.syncStatus,
    type,
  ]);
  return source;
}

/**
 * Avoid using this unless necessary. Prefer useSourceAtPath or useShallowSourceAtPath instead.
 * Reason: principles! Use only what you need...
 */
export function useSources() {
  const { syncStore } = useContext(ValContext);
  const sources: Record<ModuleFilePath, Json | undefined> = {};
  for (const moduleFilePathS in syncStore.schemas || {}) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    sources[moduleFilePath] = syncStore.getDataSnapshot(moduleFilePath).data;
  }
  return useContext(ValContext).syncStore.optimisticClientSources;
}

export function useSourceAtPath(sourcePath: SourcePath):
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
  const { syncStore } = useContext(ValContext);
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const sourceSnapshot = useSyncExternalStore(
    syncStore.subscribe("source", moduleFilePath),
    () => syncStore.getDataSnapshot(moduleFilePath),
    () => syncStore.getDataSnapshot(moduleFilePath),
  );
  return useMemo(() => {
    if (syncStore.initializedAt === null) {
      return { status: "loading" };
    }
    if (sourceSnapshot.status === "success") {
      return walkSourcePath(modulePath, sourceSnapshot.data.source);
    }
    if (
      sourceSnapshot.status === "module-schema-not-found" ||
      sourceSnapshot.status === "module-source-not-found"
    ) {
      return { status: "not-found" };
    }
    return {
      status: "error",
      error: sourceSnapshot.message || "Unknown error",
    };
  }, [sourceSnapshot, syncStore.initializedAt, modulePath, moduleFilePath]);
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
