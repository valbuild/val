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
import { FileOperation } from "@valbuild/core/patch";

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
    },
  ) as ValContextValue,
);

export function useClient() {
  return useContext(ValContext).client;
}

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

  // Theme is initialized by ValNextProvider in session storage
  // We just read it once on init and then rely on React state
  const [theme, setTheme] = useState<Themes | null>(() => {
    const storedTheme = sessionStorage.getItem(VAL_THEME_SESSION_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
    return null;
  });

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
  const [observedCommitShas, setObservedCommitShas] = useState<Set<string>>(
    new Set(),
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
  const profilesData = useProfilesData(
    client,
    authenticationState,
    serviceUnavailable,
  );
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
        portalRef: portalRef.current,
        authenticationState,
        theme,
        setTheme: (theme) => {
          if (theme === "dark" || theme === "light") {
            try {
              sessionStorage.setItem(VAL_THEME_SESSION_STORAGE_KEY, theme);
              localStorage.setItem(
                "val-theme-" + (config?.project || "unknown"),
                theme,
              );
            } catch (e) {
              console.error("Error setting theme in storage", e);
            }
            setTheme(theme);
          } else if (theme === null) {
            try {
              sessionStorage.removeItem(VAL_THEME_SESSION_STORAGE_KEY);
              localStorage.removeItem(
                "val-theme-" + (config?.project || "unknown"),
              );
            } catch (e) {
              console.error("Error removing theme from storage", e);
            }
            setTheme(null);
          } else {
            console.warn(`Cannot set invalid theme: ${theme}`);
          }
        },
        config,
        profiles:
          "data" in profilesData && profilesData.data ? profilesData.data : {},
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

function useProfilesData(
  client: ValClient,
  authenticationState: AuthenticationState,
  serviceUnavailable: boolean | undefined,
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

const textEncoder = new TextEncoder();
const SavePatchFileResponse = z.object({
  patchId: z.string().refine((v): v is PatchId => v.length > 0),
  filePath: z.string().refine((v): v is ModuleFilePath => v.length > 0),
});

export function useAddPatch(sourcePath: SourcePath | ModuleFilePath) {
  const { syncEngine, client } = useContext(ValContext);
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  const patchPath = useMemo(() => {
    return Internal.createPatchPath(modulePath);
  }, [modulePath]);
  // TODO: do we even need these callbacks now? Earlier they were useful, but after moving to syncEngine, they give us very little value
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
        res,
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

      // Create the payload once
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

      // Get byte length directly from the string
      const totalBytes = textEncoder.encode(payload).length;

      // Initial progress report
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
                    message: `While saving a file we got an unexpected response (${responseText?.slice(0, 100)}...)`,
                  },
                });
              }
            } catch (e) {
              resolve({
                status: "error",
                error: {
                  message: `Got an exception while saving a file. Error: ${e instanceof Error ? e.message : String(e)}`,
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

        // Set headers
        xhr.setRequestHeader("Content-Type", "application/json");
        for (const [key, value] of Object.entries(authHeaders)) {
          xhr.setRequestHeader(key, value);
        }

        // Send the payload
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
          // We need to know that we are writing a file, but we do not want to send all the file data
          // because we will upload it separately
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
        // Currently we upload one by one, but we could do it in parallel but before we do that, we need to figure out if that is a good idea for file uploads in particular:
        // Would it even likely be faster? How would that affect the server, ...
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
    /**
     * Prefer addPatch. Use addModuleFilePatch only if you need to add a patch to a different module file (should be rare).
     */
    addModuleFilePatch,
  };
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
    [syncEngine],
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
  const { patchErrors } = useAllPatchErrors();
  const hasPatchErrors = useMemo(() => {
    if (patchErrors) {
      return Object.values(patchErrors).some((errors) => errors !== null);
    }
  }, [patchErrors]);
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

export function useRenderOverrideAtPath(
  sourcePath: SourcePath | ModuleFilePath,
) {
  const { syncEngine } = useContext(ValContext);
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
        error: `Error resolving schema at path: ${e instanceof Error ? e.message : String(e)}`,
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

export function useGlobalTransientErrors() {
  const { syncEngine } = useContext(ValContext);
  const globalTransientErrors = useSyncExternalStore(
    syncEngine.subscribe("global-transient-errors"),
    () => syncEngine.getGlobalTransientErrorsSnapshot(),
    () => syncEngine.getGlobalTransientErrorsSnapshot(),
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
    () => syncEngine.getNetworkErrorSnapshot(),
  );
  const schemaError = useSyncExternalStore(
    syncEngine.subscribe("schema-error"),
    () => syncEngine.getSchemaErrorSnapshot(),
    () => syncEngine.getSchemaErrorSnapshot(),
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
    () => syncEngine.getAllSchemasSnapshot(),
  );
  useEffect(() => {
    setAllModuleFilePaths(Object.keys(schemas) as ModuleFilePath[]);
  }, [schemas]);

  const patchErrors = useSyncExternalStore(
    syncEngine.subscribe("patch-errors", allModuleFilePaths),
    () => syncEngine.getPatchErrorsSnapshot(allModuleFilePaths),
    () => syncEngine.getPatchErrorsSnapshot(allModuleFilePaths),
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
export function useShallowSourceAtPath<
  SchemaType extends SerializedSchema["type"],
>(
  sourcePath?: SourcePath | ModuleFilePath,
  type?: SchemaType,
): ShallowSourceOf<SchemaType> {
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
  SchemaType extends SerializedSchema["type"],
>(
  moduleFilePaths: ModuleFilePath[],
  type: SchemaType,
): ShallowSourcesOf<SchemaType> {
  const { syncEngine } = useContext(ValContext);
  const sourcesRes = useSyncExternalStore(
    syncEngine.subscribe("sources", moduleFilePaths || []),
    () => syncEngine.getSourcesSnapshot(moduleFilePaths || []),
    () => syncEngine.getSourcesSnapshot(moduleFilePaths || []),
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
          "While resolving shallow modules at paths, we unexpectedly got an undefined module file path",
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
        source,
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
          moduleFilePath as ModuleFilePath,
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

type AuthorId = string;
export type Profile = {
  fullName: string;
  email?: string; // TODO: required in the future
  avatar: {
    url: string;
  } | null;
};
