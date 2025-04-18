import React, {
  Dispatch,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { Patch } from "@valbuild/core/patch";
import { SharedValConfig, ValClient } from "@valbuild/shared/internal";
import { isJsonArray } from "../utils/isJsonArray";
import { DayPickerProvider } from "react-day-picker";
import { AuthenticationState, useStatus } from "../hooks/useStatus";
import { findRequiredRemoteFiles } from "../utils/findRequiredRemoteFiles";
import { defaultOverlayEmitter, ValSyncEngine } from "../ValSyncEngine";
import { SerializedPatchSet } from "../utils/PatchSets";
import { z } from "zod";
import {
  ValEnrichedDeployment,
  mergeCommitsAndDeployments,
} from "../utils/mergeCommitsAndDeployments";
import { TooltipProvider } from "./designSystem/tooltip";

type ValContextValue = {
  syncEngine: ValSyncEngine;
  mode: "http" | "fs" | "unknown";
  profileId: string | null;
  client: ValClient;
  publishSummaryState: PublishSummaryState;
  setPublishSummaryState: Dispatch<SetStateAction<PublishSummaryState>>;
  serviceUnavailable: boolean | undefined;
  baseSha: string | undefined;
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
  deletePatches: (patchIds: PatchId[]) => void;
  profiles: Record<AuthorId, Profile>;
  deployments: ValEnrichedDeployment[];
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
  config: SharedValConfig | null;
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
            email: profile.email,
            avatar: profile.avatar,
          };
        }
        setProfiles(profilesById);
      } else {
        console.error("Could not get profiles", res.json);
        const timeout = setTimeout(load, 2000);
        return () => {
          clearTimeout(timeout);
        };
      }
    };
    load();
  }, [authenticationState, client, serviceUnavailable]);

  const syncEngine = useMemo(
    () =>
      new ValSyncEngine(client, (moduleFilePath, newSource) => {
        if (dispatchValEvents) {
          defaultOverlayEmitter(moduleFilePath, newSource);
        }
      }),
    // TODO: add client to dependency array NOTE: we need to make sure syncing works if when syncEngine is instantiated anew
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

  const portalRef = useRef<HTMLDivElement>(null);
  const baseSha = "data" in stat && stat.data ? stat.data.baseSha : undefined;

  const [deployments, setDeployments] = useState<ValEnrichedDeployment[]>([]);
  const dismissedDeploymentsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if ("data" in stat && stat.data) {
      setDeployments((prev) => {
        if (
          (stat.data?.deployments && stat.data.deployments?.length > 0) ||
          (stat.data?.commits && stat.data.commits?.length > 0)
        ) {
          return mergeCommitsAndDeployments(
            prev,
            stat.data?.commits || [],
            stat.data?.deployments || [],
          ).filter((d) => !dismissedDeploymentsRef.current.has(d.commitSha));
        }
        return prev;
      });
    }
  }, [
    "data" in stat && stat.data?.deployments && stat.data?.deployments.length,
    "data" in stat && stat.data?.commits && stat.data?.commits.length,
  ]);
  const dismissDeployment = useCallback((commitSha: string) => {
    setDeployments((prev) => {
      return prev.filter((d) => d.commitSha !== commitSha);
    });
    dismissedDeploymentsRef.current.add(commitSha);
  }, []);

  const [remoteFiles, setRemoteFiles] = useState<
    ValContextValue["remoteFiles"]
  >({
    status: "not-asked",
  });
  const [requiresRemoteFiles, setRequiresRemoteFiles] = useState(false);
  const schemas = useSyncExternalStore(
    syncEngine.subscribe("schema"),
    () => syncEngine.getAllSchemasSnapshot(),
    () => syncEngine.getAllSchemasSnapshot(),
  );
  useEffect(() => {
    if (schemas) {
      const schemasData = schemas;
      let requiresRemoteFiles = false;
      for (const schema of Object.values(schemasData)) {
        if (findRequiredRemoteFiles(schema)) {
          requiresRemoteFiles = true;
          break;
        }
      }
      setRequiresRemoteFiles(requiresRemoteFiles);
    }
  }, [schemas]);
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

  const syncEngineInitStatus = useRef<
    "not-initialized" | "done" | "in-progress" | "retry"
  >("not-initialized");
  const [startSyncPoll, setStartSyncPoll] = useState(false);
  const initializedAt = useSyncEngineInitializedAt(syncEngine);

  useEffect(() => {
    if (initializedAt === null && syncEngineInitStatus.current === "done") {
      syncEngineInitStatus.current = "not-initialized";
    }
    if (
      "data" in stat &&
      stat.data &&
      syncEngineInitStatus.current === "not-initialized"
    ) {
      syncEngineInitStatus.current = "in-progress";
      let timeout: NodeJS.Timeout | null = null;
      const exec = async () => {
        if ("data" in stat && stat.data) {
          console.debug("ValSyncEngine init started...", stat.data.profileId);
          const res = await syncEngine.init(
            stat.data.mode,
            stat.data.baseSha,
            stat.data.schemaSha,
            stat.data.sourcesSha,
            stat.data.patches,
            stat.data.profileId,
            stat.data.commitSha ?? null,
            Date.now(),
          );
          console.debug("ValSyncEngine init result", res);
          if (res.status === "retry") {
            syncEngineInitStatus.current = "retry";
            timeout = setTimeout(exec, 4000);
          } else {
            console.debug("Val is initialized!", res);
            syncEngineInitStatus.current = "done";
            if (timeout) {
              clearTimeout(timeout);
            }
            setStartSyncPoll(true);
          }
        } else {
          syncEngineInitStatus.current = "not-initialized";
          throw Error(
            "Unexpected state: init was started with stat.data but now it is not there",
          );
        }
      };
      exec();
      return () => {
        if (timeout) {
          clearTimeout(timeout);
        }
      };
    } else if (
      "data" in stat &&
      stat.data &&
      syncEngineInitStatus.current === "done"
    ) {
      syncEngine.syncWithUpdatedStat(
        stat.data.mode,
        stat.data.baseSha,
        stat.data.schemaSha,
        stat.data.sourcesSha,
        stat.data.patches,
        stat.data.profileId,
        stat.data.commitSha ?? null,
        Date.now(),
      );
    }
  }, [stat, syncEngine, initializedAt]);

  useEffect(() => {
    if (!startSyncPoll) {
      return;
    }
    let timeout: NodeJS.Timeout | null = null;
    const sync = async () => {
      // We got a reset, so we must re-initialize
      if (initializedAt === null) {
        setStartSyncPoll(false);
        syncEngineInitStatus.current = "not-initialized";
        return;
      }
      await syncEngine.sync(Date.now());
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
  }, [syncEngine, initializedAt, startSyncPoll]);

  const [publishSummaryState, setPublishSummaryState] =
    useState<PublishSummaryState>({
      type: "not-asked",
    });

  const pendingOpsCount = useSyncExternalStore(
    syncEngine.subscribe("pending-ops-count"),
    () => syncEngine.getPendingOpsSnapshot(),
    () => syncEngine.getPendingOpsSnapshot(),
  );
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingOpsCount > 0) {
        event.preventDefault();
        event.returnValue = ""; // Required for Chrome and some other browsers
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [pendingOpsCount]);

  return (
    <ValContext.Provider
      value={{
        client,
        publishSummaryState,
        setPublishSummaryState,
        syncEngine,
        profileId: "data" in stat && stat.data ? stat.data.profileId : null,
        mode: "data" in stat && stat.data ? stat.data.mode : "unknown",
        serviceUnavailable: showServiceUnavailable,
        baseSha,
        deployments,
        dismissDeployment,
        portalRef: portalRef.current,
        authenticationState,
        addPatch: (moduleFilePath, patch, type) => {
          return syncEngine.addPatch(moduleFilePath, type, patch, Date.now());
        },
        deletePatches: (patchIds) => {
          // Delete in batches of 100 patch ids (since it is added to request url as query param)
          const batches = [];
          for (let i = 0; i < patchIds.length; i += 100) {
            batches.push(patchIds.slice(i, i + 100));
          }
          for (const batch of batches) {
            syncEngine.deletePatches(batch, Date.now());
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
        config,
        profiles,
        remoteFiles,
      }}
    >
      <TooltipProvider>
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
      </TooltipProvider>
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
        appHost: string;
      })
    | undefined
  >(
    config && {
      ...config,
      remoteHost: DEFAULT_VAL_REMOTE_HOST,
      appHost: DEFAULT_APP_HOST,
    },
  );
  useEffect(() => {
    if (config) {
      lastConfig.current = {
        ...config,
        remoteHost: DEFAULT_VAL_REMOTE_HOST,
        appHost: DEFAULT_APP_HOST,
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
  const { syncEngine } = useContext(ValContext);
  const serializedPatchSets = useSyncExternalStore(
    syncEngine.subscribe("patch-sets"),
    () => syncEngine.getSerializedPatchSetsSnapshot(),
    () => syncEngine.getSerializedPatchSetsSnapshot(),
  );
  return { status: "success", data: serializedPatchSets };
}

export function useCommittedPatches() {
  const { syncEngine } = useContext(ValContext);
  const allPatches = useSyncExternalStore(
    syncEngine.subscribe("all-patches"),
    () => syncEngine.getAllPatchesSnapshot(),
    () => syncEngine.getAllPatchesSnapshot(),
  );
  const currentPatchIds = useCurrentPatchIds();
  const committedPatchIds = useMemo(() => {
    const committedPatchIds: Set<PatchId> = new Set();
    for (const patchId of currentPatchIds) {
      const patchData = allPatches[patchId];
      if (patchData?.isCommitted) {
        committedPatchIds.add(patchId);
      }
    }
    return committedPatchIds;
  }, [allPatches, currentPatchIds]);
  return committedPatchIds;
}

export function usePendingServerSidePatchIds(): PatchId[] {
  const { syncEngine } = useContext(ValContext);
  const globalServerSidePatchIds = useSyncExternalStore(
    syncEngine.subscribe("global-server-side-patch-ids"),
    () => syncEngine.getGlobalServerSidePatchIdsSnapshot(),
    () => syncEngine.getGlobalServerSidePatchIdsSnapshot(),
  );
  return globalServerSidePatchIds;
}

export function usePendingClientSidePatchIds(): PatchId[] {
  const { syncEngine } = useContext(ValContext);
  const pendingClientSidePatchIds = useSyncExternalStore(
    syncEngine.subscribe("pending-client-side-patch-ids"),
    () => syncEngine.getPendingClientSidePatchIdsSnapshot(),
    () => syncEngine.getPendingClientSidePatchIdsSnapshot(),
  );
  return pendingClientSidePatchIds;
}

export function useCurrentPatchIds(): PatchId[] {
  const { syncEngine } = useContext(ValContext);
  const globalServerSidePatchIds = usePendingServerSidePatchIds();
  const pendingClientSidePatchIds = usePendingClientSidePatchIds();
  const savedServerSidePatchIds = useSyncExternalStore(
    syncEngine.subscribe("saved-server-side-patch-ids"),
    () => syncEngine.getSavedServerSidePatchIdsSnapshot(),
    () => syncEngine.getSavedServerSidePatchIdsSnapshot(),
  );
  const currentPatchIds = useMemo(() => {
    const added: Set<PatchId> = new Set();
    const currentPatchIds: PatchId[] = [];
    for (const patchId of globalServerSidePatchIds) {
      if (!added.has(patchId)) {
        currentPatchIds.push(patchId);
      }
      added.add(patchId);
    }
    for (const patchId of savedServerSidePatchIds) {
      if (!added.has(patchId)) {
        currentPatchIds.push(patchId);
      }
      added.add(patchId);
    }
    for (const patchId of pendingClientSidePatchIds) {
      if (!added.has(patchId)) {
        currentPatchIds.push(patchId);
      }
      added.add(patchId);
    }
    return currentPatchIds;
  }, [
    globalServerSidePatchIds,
    pendingClientSidePatchIds,
    savedServerSidePatchIds,
  ]);
  return currentPatchIds;
}

export function useValMode(): "http" | "fs" | "unknown" {
  const { mode } = useContext(ValContext);
  return mode;
}

export type LoadingStatus = "loading" | "not-asked" | "error" | "success";
export function useLoadingStatus(): LoadingStatus {
  const { syncEngine } = useContext(ValContext);
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

const PublishSummaryState = z.union([
  z.object({
    type: z.literal("not-asked"),
    isGenerating: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("manual").or(z.literal("ai")),
    text: z.string(),
    patchIds: z.array(z.string()).nullable(),
    isGenerating: z.boolean(),
  }),
]);
type PublishSummaryState = z.infer<typeof PublishSummaryState>;
/**
 * Responsible for publishing and also managing publishing state
 */
export function usePublishSummary() {
  const {
    syncEngine,
    client,
    publishSummaryState,
    setPublishSummaryState,
    config,
  } = useContext(ValContext);
  const globalServerSidePatchIds = useCurrentPatchIds();
  const publishDisabled = useSyncExternalStore(
    syncEngine.subscribe("publish-disabled"),
    () => syncEngine.getPublishDisabledSnapshot(),
    () => syncEngine.getPublishDisabledSnapshot(),
  );
  const [canGenerate, setCanGenerate] = useState(false);
  useEffect(() => {
    if (
      config?.ai?.commitMessages?.disabled === undefined ||
      config.ai.commitMessages.disabled === false
    ) {
      setCanGenerate(true);
    } else {
      setCanGenerate(false);
    }
  }, [config]);
  useEffect(() => {
    if (publishSummaryState.type === "not-asked") {
      const storedSummaryState = getSummaryStateFromLocalStorage(
        config?.project,
      );
      if (
        storedSummaryState &&
        storedSummaryState.type !== "not-asked" &&
        // Only load if there's actually patches to publish
        globalServerSidePatchIds.length > 0
      ) {
        setPublishSummaryState(storedSummaryState);
      }
    }
  }, [publishSummaryState, config?.project, setPublishSummaryState]);
  const generateSummary = useCallback(async (): Promise<
    { type: "ai"; text: string } | { type: "error"; message: string }
  > => {
    if (globalServerSidePatchIds === null) {
      return {
        type: "error",
        message: "Empty patch set",
      };
    }
    if (
      "isGenerating" in publishSummaryState &&
      publishSummaryState.isGenerating
    ) {
      return {
        type: "error",
        message: "Already generating summary",
      };
    }
    setPublishSummaryState((prev) => {
      return {
        ...prev,
        isGenerating: true,
      };
    });
    try {
      const res = await client("/commit-summary", "GET", {
        query: {
          patch_id: globalServerSidePatchIds,
        },
      });
      if (res.status === 200) {
        if (res.json.commitSummary) {
          return { type: "ai", text: res.json.commitSummary };
        } else {
          return {
            type: "error",
            message: "Commit summary could not be generated",
          };
        }
      } else {
        return { type: "error", message: res.json.message };
      }
    } finally {
      setPublishSummaryState((prev) => {
        return {
          ...prev,
          isGenerating: false,
        };
      });
    }
  }, [client, globalServerSidePatchIds, publishSummaryState]);
  const [isPublishing, setIsPublishing] = useState(false);
  const publish = useCallback(
    async (summary: string) => {
      if (globalServerSidePatchIds === null) {
        return {
          status: "error",
          message: "No changes to publish",
        };
      }
      if (isPublishing) {
        return {
          status: "error",
          message: "Already publishing",
        };
      }
      setIsPublishing(true);
      return syncEngine
        .publish(globalServerSidePatchIds, summary, Date.now())
        .then((res) => {
          if (res.status === "done") {
            deleteSummaryStateFromLocalStorage(config?.project);
            setPublishSummaryState((prev) => ({
              type: "not-asked",
              isGenerating: prev.isGenerating,
            }));
          }
          return res;
        })
        .finally(() => {
          setIsPublishing(false);
        });
    },
    [globalServerSidePatchIds, isPublishing, config?.project, syncEngine],
  );
  const setSummary = useCallback(
    (
      summary:
        | { type: "manual" | "ai"; text: string }
        | {
            type: "not-asked";
          },
    ) => {
      setPublishSummaryState((prev) => {
        let publishSummary: PublishSummaryState;
        if (summary.type === "not-asked") {
          publishSummary = {
            type: "not-asked",
            isGenerating: prev.isGenerating,
          };
        } else {
          publishSummary = {
            type: summary.type,
            text: summary.text,
            patchIds: globalServerSidePatchIds,
            isGenerating: !!prev.isGenerating,
          };
        }
        saveSummaryStateInLocalStorage(publishSummary, config?.project);
        return publishSummary;
      });
    },
    [globalServerSidePatchIds, setPublishSummaryState, config?.project],
  );
  return {
    publish,
    publishDisabled,
    isPublishing,
    generateSummary,
    canGenerate,
    summary: publishSummaryState,
    setSummary,
  };
}

function saveSummaryStateInLocalStorage(
  publishSummaryState: PublishSummaryState,
  project?: string,
) {
  try {
    localStorage.setItem(
      "val-publish-summary-" + (project || "unknown"),
      JSON.stringify(publishSummaryState),
    );
  } catch (e) {
    console.error("Error setting publish summary in local storage", e);
  }
  return publishSummaryState;
}

function getSummaryStateFromLocalStorage(
  project?: string,
): PublishSummaryState | null {
  try {
    const publishSummaryState = localStorage.getItem(
      "val-publish-summary-" + (project || "unknown"),
    );
    if (publishSummaryState) {
      const parseRes = PublishSummaryState.safeParse(
        JSON.parse(publishSummaryState),
      );
      if (parseRes.success) {
        return parseRes.data;
      } else {
        console.warn(
          "Error parsing publish summary from local storage",
          parseRes.error,
        );
      }
    }
  } catch (e) {
    console.error("Error getting publish summary from local storage", e);
  }
  return null;
}

function deleteSummaryStateFromLocalStorage(project?: string) {
  try {
    localStorage.removeItem("val-publish-summary-" + (project || "unknown"));
  } catch (e) {
    console.error("Error deleting publish summary from local storage", e);
  }
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

export function useCurrentProfile() {
  const { profileId, profiles } = useContext(ValContext);
  if (profileId) {
    return profiles[profileId] ?? null;
  }
  return null;
}

export const useSyncEngineInitializedAt = (syncEngine: ValSyncEngine) => {
  const initializedAt = useSyncExternalStore(
    syncEngine.subscribe("initialized-at"),
    () => syncEngine.getInitializedAtSnapshot(),
    () => syncEngine.getInitializedAtSnapshot(),
  );
  return initializedAt.data;
};

export function useAutoPublish() {
  const { syncEngine } = useContext(ValContext);
  const autoPublish = useSyncExternalStore(
    syncEngine.subscribe("auto-publish"),
    () => syncEngine.getAutoPublishSnapshot(),
    () => syncEngine.getAutoPublishSnapshot(),
  );
  return {
    autoPublish,
    setAutoPublish: (autoPublish: boolean) => {
      syncEngine.setAutoPublish(Date.now(), autoPublish);
    },
  };
}

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
  const { syncEngine } = useContext(ValContext);
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
    const resolvedSchemaAtPath = Internal.resolvePath(
      modulePath,
      sourcesRes.data,
      schemaRes.data,
    )?.schema;
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
  const { syncEngine } = useContext(ValContext);
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

export function useValidationErrors(sourcePath: SourcePath) {
  const { syncEngine } = useContext(ValContext);
  const data = useSyncExternalStore(
    syncEngine.subscribe("validation-error", sourcePath),
    () => syncEngine.getValidationErrorSnapshot(sourcePath),
    () => syncEngine.getValidationErrorSnapshot(sourcePath),
  );
  return data || [];
}
export function useAllValidationErrors() {
  const { syncEngine } = useContext(ValContext);
  const validationErrors = useSyncExternalStore(
    syncEngine.subscribe("all-validation-errors"),
    () => syncEngine.getAllValidationErrorsSnapshot(),
    () => syncEngine.getAllValidationErrorsSnapshot(),
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
  const { syncEngine } = useContext(ValContext);
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

export function useAllSources() {
  const { syncEngine } = useContext(ValContext);
  const sources = useSyncExternalStore(
    syncEngine.subscribe("all-sources"),
    () => syncEngine.getAllSourcesSnapshot(),
    () => syncEngine.getAllSourcesSnapshot(),
  );
  return sources;
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
  const { syncEngine } = useContext(ValContext);
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
  email?: string; // TODO: required in the future
  avatar: {
    url: string;
  } | null;
};
