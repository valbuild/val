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
import { Operation, Patch } from "@valbuild/core/patch";
import {
  ParentRef,
  SharedValConfig,
  ValClient,
  getNextAppRouterSourceFolder,
  VAL_THEME_SESSION_STORAGE_KEY,
} from "@valbuild/shared/internal";
import { isJsonArray } from "../utils/isJsonArray";
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
import { FileOperation } from "@valbuild/core/patch";
import { useSchemas } from "./ValFieldProvider";
import { ValThemeProvider, Themes } from "./ValThemeProvider";
import { ValErrorProvider } from "./ValErrorProvider";
import { ValPortalProvider } from "./ValPortalProvider";
import { ValFieldProvider } from "./ValFieldProvider";
import { ValRemoteProvider } from "./ValRemoteProvider";

type ValContextValue = {
  syncEngine: ValSyncEngine;
  mode: "http" | "fs" | "unknown";
  profileId: string | null;
  client: ValClient;
  publishSummaryState: PublishSummaryState;
  setPublishSummaryState: Dispatch<SetStateAction<PublishSummaryState>>;
  serviceUnavailable: boolean | undefined;
  baseSha: string | undefined;
  config: ValConfig | undefined;
  authenticationState: AuthenticationState;
  profiles: Record<AuthorId, Profile>;
  deployments: ValEnrichedDeployment[];
  dismissDeployment: (deploymentId: string) => void;
  observedCommitShas: Set<string>;
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
        message: string;
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
    }
  ) as ValContextValue
);

export function useClient() {
  return useContext(ValContext).client;
}

export function ValProvider({
  children,
  client,
  config: initialConfig,
  dispatchValEvents,
  theme,
  setTheme,
}: {
  children: React.ReactNode;
  client: ValClient;
  config: SharedValConfig | null;
  dispatchValEvents: boolean;
  theme?: Themes | null;
  setTheme?: (theme: Themes | null) => void;
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

  const syncEngine = useMemo(
    () =>
      new ValSyncEngine(client, (moduleFilePath, newSource) => {
        if (dispatchValEvents) {
          defaultOverlayEmitter(moduleFilePath, newSource);
        }
      }),
    // TODO: add client to dependency array NOTE: we need to make sure syncing works if when syncEngine is instantiated anew
    [dispatchValEvents]
  );
  const runtimeConfig =
    "data" in stat && stat.data ? (stat.data.config as ValConfig) : undefined;

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
            stat.data?.deployments || []
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
  const [observedCommitShas, setObservedCommitShas] = useState<Set<string>>(
    new Set()
  );
  useEffect(() => {
    if ("data" in stat && stat.data?.commitSha) {
      setObservedCommitShas((prev) => {
        if (
          stat.data?.commitSha === undefined ||
          prev.has(stat.data.commitSha)
        ) {
          return prev;
        }
        const newSeenCommitShas = new Set(prev);
        newSeenCommitShas.add(stat.data.commitSha);
        return newSeenCommitShas;
      });
    }
  }, [stat]);

  const [remoteFiles, setRemoteFiles] = useState<
    ValContextValue["remoteFiles"]
  >({
    status: "not-asked",
  });
  const [requiresRemoteFiles, setRequiresRemoteFiles] = useState(false);
  const schemas = useSyncExternalStore(
    syncEngine.subscribe("schema"),
    () => syncEngine.getAllSchemasSnapshot(),
    () => syncEngine.getAllSchemasSnapshot()
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
                  (bucket) => bucket.bucket
                ),
                publicProjectId: res.json.publicProjectId,
              });
            } else {
              if ("errorCode" in res.json && res.json.errorCode) {
                setRemoteFiles({
                  status: "inactive",
                  reason: res.json.errorCode,
                  message: res.json.message,
                });
              } else {
                setRemoteFiles({
                  status: "inactive",
                  reason: "unknown-error",
                  message: "An unknown error has occurred",
                });
              }
              setTimeout(loadRemoteSettings, 5000);
            }
          })
          .catch((err) => {
            console.error("Error getting remote settings", err);
            setRemoteFiles({
              status: "inactive",
              reason: "unknown-error",
              message: "An unknown error has occurred",
            });
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
            Date.now()
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
            "Unexpected state: init was started with stat.data but now it is not there"
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
        Date.now()
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
    () => syncEngine.getPendingOpsSnapshot()
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
  const profilesData = useProfilesData(
    client,
    authenticationState,
    serviceUnavailable
  );

  const getDirectFileUploadSettings = useCallback(async (): Promise<
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
  > => {
    let res = await client("/direct-file-upload-settings", "POST", {});
    let retries = 0;
    while (res.status === null && retries < 5) {
      console.warn(
        "Failed to get direct file upload settings, retrying...",
        res
      );
      await new Promise((resolve) => setTimeout(resolve, 500 * (retries + 1)));
      res = await client("/direct-file-upload-settings", "POST", {});
      retries++;
    }
    if (res.status === 200) {
      return { status: "success", data: res.json };
    }
    return {
      status: "error",
      error: "Could not get direct file upload settings",
    };
  }, [client]);

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
        observedCommitShas,
        deployments,
        dismissDeployment,
        authenticationState,
        config: runtimeConfig,
        profiles:
          "data" in profilesData && profilesData.data ? profilesData.data : {},
        remoteFiles,
      }}
    >
      <TooltipProvider>
        {theme !== undefined && setTheme ? (
          <ValThemeProvider
            theme={theme}
            setTheme={setTheme}
            config={runtimeConfig}
          >
            <ValErrorProvider syncEngine={syncEngine}>
              <ValPortalProvider>
                <ValRemoteProvider remoteFiles={remoteFiles}>
                  <ValFieldProvider
                    syncEngine={syncEngine}
                    getDirectFileUploadSettings={getDirectFileUploadSettings}
                    config={runtimeConfig}
                  >
                    {children}
                  </ValFieldProvider>
                </ValRemoteProvider>
              </ValPortalProvider>
            </ValErrorProvider>
          </ValThemeProvider>
        ) : (
          children
        )}
      </TooltipProvider>
    </ValContext.Provider>
  );
}

function useProfilesData(
  client: ValClient,
  authenticationState: AuthenticationState,
  serviceUnavailable: boolean | undefined
) {
  const loadProfileDataRef = useRef(true);
  const [profilesData, setProfilesData] = useState<
    | {
        data: Record<AuthorId, Profile>;
        status: "done";
      }
    | {
        data?: Record<AuthorId, Profile>;
        status: "loading" | "error";
      }
    | {
        status: "not-asked";
      }
  >({ status: "not-asked" });
  const loadProfiles = useCallback(async () => {
    setProfilesData((prev) => ({
      status: "loading",
      data: "data" in prev ? prev.data : undefined,
    }));
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
      setProfilesData({
        status: "done",
        data: profilesById,
      });
    } else {
      console.error("Could not get profiles", res.json);
      loadProfileDataRef.current = true;
      setProfilesData((prev) => ({
        status: "error",
        data: "data" in prev ? prev.data : undefined,
      }));
    }
  }, [client, profilesData]);
  useEffect(() => {
    if (!loadProfileDataRef.current) {
      return;
    }
    loadProfileDataRef.current = false;
    if (profilesData.status === "error") {
      // Wait a bit before retrying...
      setTimeout(() => loadProfiles(), 2000);
    } else if (profilesData.status === "not-asked") {
      loadProfiles();
    }
  }, [authenticationState, client, profilesData, serviceUnavailable]);

  return profilesData;
}

export function useAuthenticationState() {
  const { authenticationState } = useContext(ValContext);
  return authenticationState;
}

export function useConnectionStatus() {
  const { serviceUnavailable } = useContext(ValContext);
  return serviceUnavailable === true ? "service-unavailable" : "connected";
}

/**
 * Hook to add a patch to any module file path.
 * Use this when you need to add a patch dynamically to different modules.
 */
export function useAddModuleFilePatch() {
  const { syncEngine } = useContext(ValContext);
  const addModuleFilePatch = useCallback(
    (
      moduleFilePath: ModuleFilePath,
      patch: Patch,
      type: SerializedSchema["type"]
    ) => {
      syncEngine.addPatch(moduleFilePath, type, patch, Date.now());
    },
    [syncEngine]
  );
  return { addModuleFilePatch };
}

export function useDeletePatches() {
  const { syncEngine } = useContext(ValContext);
  const deletePatches = useCallback(
    (patchIds: PatchId[]) => {
      // Delete in batches of 100 patch ids (since it is added to request url as query param)
      const batches = [];
      for (let i = 0; i < patchIds.length; i += 100) {
        batches.push(patchIds.slice(i, i + 100));
      }
      for (const batch of batches) {
        syncEngine.deletePatches(batch, Date.now());
      }
    },
    [syncEngine]
  );
  return { deletePatches };
}

export function useDeployments() {
  const { deployments, dismissDeployment, observedCommitShas } =
    useContext(ValContext);
  return { deployments, dismissDeployment, observedCommitShas };
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
    () => syncEngine.getSerializedPatchSetsSnapshot()
  );
  return { status: "success", data: serializedPatchSets };
}

export function useCommittedPatches() {
  const { syncEngine } = useContext(ValContext);
  const allPatches = useSyncExternalStore(
    syncEngine.subscribe("all-patches"),
    () => syncEngine.getAllPatchesSnapshot(),
    () => syncEngine.getAllPatchesSnapshot()
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
    () => syncEngine.getGlobalServerSidePatchIdsSnapshot()
  );
  return globalServerSidePatchIds;
}

export function usePendingClientSidePatchIds(): PatchId[] {
  const { syncEngine } = useContext(ValContext);
  const pendingClientSidePatchIds = useSyncExternalStore(
    syncEngine.subscribe("pending-client-side-patch-ids"),
    () => syncEngine.getPendingClientSidePatchIdsSnapshot(),
    () => syncEngine.getPendingClientSidePatchIdsSnapshot()
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
    () => syncEngine.getSavedServerSidePatchIdsSnapshot()
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
    () => syncEngine.getPendingOpsSnapshot()
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
    config: runtimeConfig,
  } = useContext(ValContext);
  const globalServerSidePatchIds = useCurrentPatchIds();
  const publishDisabled = useSyncExternalStore(
    syncEngine.subscribe("publish-disabled"),
    () => syncEngine.getPublishDisabledSnapshot(),
    () => syncEngine.getPublishDisabledSnapshot()
  );
  const { patchErrors } = useAllPatchErrors();
  const hasPatchErrors = useMemo(() => {
    if (patchErrors) {
      return Object.values(patchErrors).some((errors) => errors !== null);
    }
  }, [patchErrors]);
  const [canGenerate, setCanGenerate] = useState(false);
  useEffect(() => {
    if (
      runtimeConfig?.ai?.commitMessages?.disabled === undefined ||
      runtimeConfig.ai.commitMessages.disabled === false
    ) {
      setCanGenerate(true);
    } else {
      setCanGenerate(false);
    }
  }, [runtimeConfig]);
  useEffect(() => {
    if (publishSummaryState.type === "not-asked") {
      const storedSummaryState = getSummaryStateFromLocalStorage(
        runtimeConfig?.project
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
  }, [publishSummaryState, runtimeConfig, setPublishSummaryState]);
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
            deleteSummaryStateFromLocalStorage(runtimeConfig?.project);
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
    [globalServerSidePatchIds, isPublishing, runtimeConfig?.project, syncEngine]
  );
  const setSummary = useCallback(
    (
      summary:
        | { type: "manual" | "ai"; text: string }
        | {
            type: "not-asked";
          }
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
        saveSummaryStateInLocalStorage(publishSummary, runtimeConfig?.project);
        return publishSummary;
      });
    },
    [globalServerSidePatchIds, setPublishSummaryState, runtimeConfig?.project]
  );
  return {
    publish,
    publishDisabled: publishDisabled || hasPatchErrors,
    isPublishing,
    generateSummary,
    canGenerate,
    summary: publishSummaryState,
    setSummary,
  };
}

function saveSummaryStateInLocalStorage(
  publishSummaryState: PublishSummaryState,
  project?: string
) {
  try {
    localStorage.setItem(
      "val-publish-summary-" + (project || "unknown"),
      JSON.stringify(publishSummaryState)
    );
  } catch (e) {
    console.error("Error setting publish summary in local storage", e);
  }
  return publishSummaryState;
}

function getSummaryStateFromLocalStorage(
  project?: string
): PublishSummaryState | null {
  try {
    const publishSummaryState = localStorage.getItem(
      "val-publish-summary-" + (project || "unknown")
    );
    if (publishSummaryState) {
      const parseRes = PublishSummaryState.safeParse(
        JSON.parse(publishSummaryState)
      );
      if (parseRes.success) {
        return parseRes.data;
      } else {
        console.warn(
          "Error parsing publish summary from local storage",
          parseRes.error
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
    () => syncEngine.getInitializedAtSnapshot()
  );
  return initializedAt.data;
};

export function useAutoPublish() {
  const { syncEngine } = useContext(ValContext);
  const autoPublish = useSyncExternalStore(
    syncEngine.subscribe("auto-publish"),
    () => syncEngine.getAutoPublishSnapshot(),
    () => syncEngine.getAutoPublishSnapshot()
  );
  return {
    autoPublish,
    setAutoPublish: (autoPublish: boolean) => {
      syncEngine.setAutoPublish(Date.now(), autoPublish);
    },
  };
}

export function useGlobalTransientErrors() {
  const { syncEngine } = useContext(ValContext);
  const globalTransientErrors = useSyncExternalStore(
    syncEngine.subscribe("global-transient-errors"),
    () => syncEngine.getGlobalTransientErrorsSnapshot(),
    () => syncEngine.getGlobalTransientErrorsSnapshot()
  );
  return {
    globalTransientErrors,
    removeGlobalTransientErrors: (ids: string[]) => {
      syncEngine.removeGlobalTransientErrors(ids);
    },
  };
}

export function useGlobalError():
  | { type: "network-error"; networkError: number }
  | { type: "schema-error"; schemaError: number }
  | {
      type: "remote-files-error";
      error: string;
      reason:
        | "unknown-error"
        | "project-not-configured"
        | "api-key-missing"
        | "pat-error"
        | "error-could-not-get-settings"
        | "no-internet-connection"
        | "unauthorized-personal-access-token-error"
        | "unauthorized";
    }
  | null {
  const { syncEngine, remoteFiles } = useContext(ValContext);
  const networkError = useSyncExternalStore(
    syncEngine.subscribe("network-error"),
    () => syncEngine.getNetworkErrorSnapshot(),
    () => syncEngine.getNetworkErrorSnapshot()
  );
  const schemaError = useSyncExternalStore(
    syncEngine.subscribe("schema-error"),
    () => syncEngine.getSchemaErrorSnapshot(),
    () => syncEngine.getSchemaErrorSnapshot()
  );
  if (networkError !== null) {
    return {
      type: "network-error" as const,
      networkError,
    };
  }
  if (schemaError !== null) {
    return {
      type: "schema-error" as const,
      schemaError,
    };
  }
  if (remoteFiles.status === "inactive") {
    return {
      type: "remote-files-error" as const,
      error: remoteFiles.message,
      reason: remoteFiles.reason,
    };
  }
  return null;
}

export function useAllPatchErrors() {
  const { syncEngine } = useContext(ValContext);
  const [allModuleFilePaths, setAllModuleFilePaths] = useState<
    ModuleFilePath[]
  >([]);
  const schemas = useSyncExternalStore(
    syncEngine.subscribe("schema"),
    () => syncEngine.getAllSchemasSnapshot(),
    () => syncEngine.getAllSchemasSnapshot()
  );
  useEffect(() => {
    setAllModuleFilePaths(Object.keys(schemas) as ModuleFilePath[]);
  }, [schemas]);

  const patchErrors = useSyncExternalStore(
    syncEngine.subscribe("patch-errors", allModuleFilePaths),
    () => syncEngine.getPatchErrorsSnapshot(allModuleFilePaths),
    () => syncEngine.getPatchErrorsSnapshot(allModuleFilePaths)
  );
  return { patchErrors };
}

export function useErrors() {
  const globalErrors: string[] = [];
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

  return { globalErrors, skippedPatches };
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

type ShallowSourcesOf<SchemaType extends SerializedSchema["type"]> =
  | {
      status: "not-found";
      data: ShallowSource[SchemaType][];
      notFoundPaths: ModuleFilePath[];
    }
  | {
      status: "success";
      data: ShallowSource[SchemaType][] | null;
    }
  | {
      status: "loading";
      data?: ShallowSource[SchemaType][] | null;
    }
  | {
      status: "error";
      data?: ShallowSource[SchemaType][] | null;
      errors: { moduleFilePath: ModuleFilePath; message: string }[];
    };
export function useShallowModulesAtPaths<
  SchemaType extends SerializedSchema["type"]
>(
  moduleFilePaths: ModuleFilePath[],
  type: SchemaType
): ShallowSourcesOf<SchemaType> {
  const { syncEngine } = useContext(ValContext);
  const sourcesRes = useSyncExternalStore(
    syncEngine.subscribe("sources", moduleFilePaths || []),
    () => syncEngine.getSourcesSnapshot(moduleFilePaths || []),
    () => syncEngine.getSourcesSnapshot(moduleFilePaths || [])
  );
  const initializedAt = useSyncEngineInitializedAt(syncEngine);
  return useMemo((): ShallowSourcesOf<SchemaType> => {
    if (initializedAt === null) {
      return { status: "loading" };
    }
    if (!sourcesRes) {
      return {
        status: "not-found",
        data: [],
        notFoundPaths: moduleFilePaths || [],
      };
    }
    const allSources: ShallowSource[SchemaType][] = [];
    const errors: { moduleFilePath: ModuleFilePath; message: string }[] = [];
    const notFoundPaths: ModuleFilePath[] = [];
    if (!moduleFilePaths || moduleFilePaths.length === 0) {
      return { status: "success", data: [] };
    }
    for (let i = 0; i < moduleFilePaths.length; i++) {
      const moduleFilePath = moduleFilePaths?.[i];
      if (moduleFilePath === undefined) {
        // should never happen
        throw new Error(
          "While resolving shallow modules at paths, we unexpectedly got an undefined module file path"
        );
      }
      const source = sourcesRes?.[i];
      if (!source) {
        notFoundPaths.push(moduleFilePath);
      }
      const mappedSource = mapSource(
        moduleFilePath,
        "" as ModulePath,
        type,
        source
      );

      if (mappedSource.status === "success") {
        allSources.push(mappedSource.data as ShallowSource[SchemaType]);
      } else {
        errors.push({ moduleFilePath, message: mappedSource.error });
      }
    }
    if (notFoundPaths.length > 0) {
      return { status: "not-found", data: allSources, notFoundPaths };
    }
    if (errors.length > 0) {
      return { status: "error", data: allSources, errors };
    }
    return {
      status: "success",
      data: allSources,
    };
  }, [sourcesRes, type, initializedAt, moduleFilePaths]);
}

// TODO: this should be in the next package somehow - that might require a lot of refactoring to accomplish though
export function useNextAppRouterSrcFolder():
  | {
      status: "success";
      data: string | null;
    }
  | {
      status: "error";
      error: string;
    }
  | {
      status: "loading";
    } {
  const schemas = useSchemas();
  return useMemo(() => {
    if (schemas.status === "success") {
      let currentSrcFolder: string | null = null;
      for (const moduleFilePath in schemas.data) {
        const maybeCurrentSrcFolder = getNextAppRouterSourceFolder(
          moduleFilePath as ModuleFilePath
        );
        if (maybeCurrentSrcFolder) {
          if (currentSrcFolder === null) {
            currentSrcFolder = maybeCurrentSrcFolder;
          } else {
            if (currentSrcFolder !== maybeCurrentSrcFolder) {
              return {
                status: "error",
                error:
                  "Found multiple different src folders in the same project",
              };
            }
          }
        }
      }
      return { status: "success", data: currentSrcFolder };
    }
    return schemas;
  }, [schemas]);
}

function walkSourcePath(
  modulePath: ModulePath,
  sources?: Json
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
        error: `Expected object at ${modulePath}, got ${JSON.stringify(
          source
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
  SchemaType extends SerializedSchema["type"]
>(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath,
  type: SchemaType,
  sources: Json,
  clientSideOnly: boolean
): ShallowSourceOf<SchemaType> {
  const source = walkSourcePath(modulePath, sources);
  if ("data" in source && source.data !== undefined) {
    const mappedSource = mapSource(
      moduleFilePath,
      modulePath,
      type,
      source.data
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
  source: Json
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
          source
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
  key: string | number
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
