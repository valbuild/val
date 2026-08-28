import React, {
  createContext,
  Dispatch,
  ReactNode,
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
  hasRemoteFileSchema,
  ImageMetadata,
  Internal,
  Json,
  ModuleFilePath,
  ModulePath,
  PatchId,
  SerializedSchema,
  SourcePath,
  ValConfig,
  ValModules,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import {
  ParentRef,
  SharedValConfig,
  ValClient,
  getNextAppRouterSourceFolder,
} from "@valbuild/shared/internal";
import { isJsonArray } from "../utils/isJsonArray";
import { readableProfilesError } from "../utils/readableProfilesError";
import { describePublishRefusal } from "../utils/describePublishRefusal";
import type { ChainProgress } from "../utils/describePendingChangesStall";
import type { PublishResult } from "../stores/PublishSeam";
import { AuthenticationState, useStatus } from "../hooks/useStatus";
import { SerializedPatchSet } from "../utils/PatchSets";
import { z } from "zod";
import {
  ValEnrichedDeployment,
  mergeCommitsAndDeployments,
} from "../utils/mergeCommitsAndDeployments";
import { TooltipProvider } from "./designSystem/tooltip";
import { SchemaOutOfDateDialog } from "./SchemaOutOfDateDialog";
import { LocalModulesErrorBanner } from "./LocalModulesErrorBanner";
import { useSchemas } from "./ValFieldProvider";
import { ValThemeProvider, Themes } from "./ValThemeProvider";
import { ValErrorProvider } from "./ValErrorProvider";
import { ValPortalProvider } from "./ValPortalProvider";
import { ValFieldProvider } from "./ValFieldProvider";
import { ValStoreProvider } from "../stores/react/ValStoreProvider";
import { useValSystem } from "../stores/react/SystemContext";
import type { StatusSnapshot } from "../stores/StatusStore";
import type { PatchErrorEntry, PatchRecord } from "../stores/types";
import { ValOverlayEmitter } from "../stores/react/ValOverlayEmitter";
import { createValSystem } from "../stores/react/createValSystem";
import { ValRemoteProvider } from "./ValRemoteProvider";
import { AIChatActionsProvider } from "./AIChatActionsContext";
import {
  useAIWebSocket,
  type AIMessageHandler,
  type AIClientMessage,
  type AISession,
  AITool,
} from "../hooks/useAIWebSocket";
import { concatModulePath } from "../utils/sourcePath";

export type { AITool };

export const AIPromptMessage = z.object({
  type: z.literal("ai_prompt"),
  id: z.string(),
  sessionId: z.string().uuid().optional(),
  message: z.string(),
  context: z.string().optional(),
  maxIterations: z.number().int().min(1).max(200).optional(),
  agents: z
    .array(
      z.object({
        id: z.string(),
        systemPrompt: z.string(),
        model: z.string(),
        tools: z.array(AITool).optional(),
        description: z.string().optional(),
      }),
    )
    .min(1),
});

export type AISessionsResponse = {
  sessions: AISession[];
  nextCursor?: { updatedAt: string; id: string } | null;
};

export class SessionImageToPatchError extends Error {
  availableKeys?: string[];
  constructor(message: string, availableKeys?: string[]) {
    super(message);
    this.name = "SessionImageToPatchError";
    this.availableKeys = availableKeys;
  }
}

export type AIContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string };

export type AIMessageContent = string | AIContentBlock[];

export type AIMessagesResponse = {
  messages: { role: string; content: AIMessageContent }[];
  nextCursor?: { updatedAt: string; id: string } | null;
};

type ValContextValue = {
  mode: "http" | "fs" | "unknown";
  profileId: string | null;
  profileAuthError: string | null;
  /**
   * Why loading the people who made the changes failed, if it did.
   *
   * Separate from `profileAuthError`, which is only the `fs`-mode 401 and is
   * shown as a global banner. This is any other failure — a project that is not
   * configured, a server that is down — and it is not global: the studio works
   * fine without knowing who anyone is, so it belongs beside the account rather
   * than across the top of the screen.
   */
  profilesError: { message: string; willRetry: boolean } | null;
  /** Ask for the profiles again, from the first attempt. */
  retryProfiles: () => void;
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
  subscribeToWsMessages: (handler: AIMessageHandler) => () => void;
  sendWsMessage: (data: AIClientMessage) => boolean;
  isWsConnected: boolean;
  aiAuthError: boolean;
  /**
   * Why the assistant is unavailable, once the studio has stopped trying.
   *
   * Distinct from `aiAuthError`, which is the 401 and terminal from the first
   * answer. This is any other failure that has run out of attempts.
   */
  aiConnectionError: string | null;
  /** Try the assistant's connection again, from the first attempt. */
  retryAiConnection: () => void;
  aiGetSessions: (opts?: {
    limit?: number;
    cursor?: { updatedAt: string; id: string };
  }) => Promise<AISessionsResponse>;
  aiGetSessionMessages: (
    sessionId: string,
    opts?: {
      limit?: number;
      cursor?: { updatedAt: string; id: string };
    },
  ) => Promise<AIMessagesResponse>;
  aiSetSessionName: (sessionId: string, name: string) => Promise<void>;
  aiSessionImagesToPatchFile: (args: {
    patchId: PatchId;
    parentRef: ParentRef;
    files: { filePath: string; key: string; isRemote?: boolean }[];
  }) => Promise<{
    patchId: PatchId;
    files: { filePath: string; metadata: ImageMetadata }[];
  }>;
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
  config: _config,
  valModules,
  dispatchValEvents,
  theme,
  setTheme,
}: {
  children: React.ReactNode;
  client: ValClient;
  config: SharedValConfig | null;
  valModules?: ValModules | null;
  dispatchValEvents: boolean;
  theme?: Themes | null;
  setTheme?: (theme: Themes | null) => void;
}) {
  // config parameter is unused but kept for API compatibility
  void _config;
  const [
    stat,
    _setStat,
    authenticationState,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setAuthenticationLoadingIfNotAuthenticated,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setIsAuthenticated,
    serviceUnavailable,
  ] = useStatus(client);

  const isStatConnected = "data" in stat && !!stat.data;
  const wsEnabled =
    isStatConnected &&
    ("data" in stat && stat.data
      ? stat.data.config?.ai?.chat?.experimental?.enable === true
      : false);
  const {
    subscribeToMessages: subscribeToWsMessages,
    send: sendWsMessage,
    isConnected: isWsConnected,
    authError: aiAuthError,
    connectionError: aiConnectionError,
    retryConnection: retryAiConnection,
  } = useAIWebSocket(wsEnabled, client);

  const aiGetSessions = useCallback(
    async (opts?: {
      limit?: number;
      cursor?: { updatedAt: string; id: string };
    }): Promise<AISessionsResponse> => {
      const res = await client("/ai/sessions", "GET", {
        query: {
          limit: opts?.limit !== undefined ? String(opts.limit) : undefined,
          cursor_updatedAt: opts?.cursor?.updatedAt,
          cursor_id: opts?.cursor?.id,
        },
      });
      if (res.status === 200) return res.json;
      throw new Error(
        `ai/sessions failed: ${res.status ?? "network"}: ${res.json.message}`,
      );
    },
    [client],
  );

  const aiGetSessionMessages = useCallback(
    async (
      sessionId: string,
      opts?: {
        limit?: number;
        cursor?: { updatedAt: string; id: string };
      },
    ): Promise<AIMessagesResponse> => {
      const res = await client("/ai/messages", "GET", {
        path: `/${encodeURIComponent(sessionId)}/messages`,
        query: {
          limit: opts?.limit !== undefined ? String(opts.limit) : undefined,
          cursor_updatedAt: opts?.cursor?.updatedAt,
          cursor_id: opts?.cursor?.id,
        },
      });
      if (res.status === 200) return res.json;
      throw new Error(
        `ai/sessions/messages failed: ${res.status ?? "network"}: ${res.json.message}`,
      );
    },
    [client],
  );

  const aiSetSessionName = useCallback(
    async (sessionId: string, name: string): Promise<void> => {
      const res = await client("/ai/sessions", "PATCH", {
        path: `/${encodeURIComponent(sessionId)}`,
        body: { name },
      });
      if (res.status === 200) return;
      throw new Error(
        `ai/sessions/rename failed: ${res.status ?? "network"}: ${res.json.message}`,
      );
    },
    [client],
  );

  const aiSessionImagesToPatchFile = useCallback(
    async (args: {
      patchId: PatchId;
      parentRef: ParentRef;
      files: { filePath: string; key: string; isRemote?: boolean }[];
    }): Promise<{
      patchId: PatchId;
      files: { filePath: string; metadata: ImageMetadata }[];
    }> => {
      const res = await client("/ai/session-image-to-patch-file", "POST", {
        body: args,
      });
      if (res.status === 200) return res.json;
      if (res.status === 400) {
        throw new SessionImageToPatchError(
          `ai/session-image-to-patch-file failed: 400: ${res.json.message}`,
          res.json.details?.availableKeys,
        );
      }
      throw new SessionImageToPatchError(
        `ai/session-image-to-patch-file failed: ${res.status ?? "network"}: ${res.json.message}`,
      );
    },
    [client],
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
  /**
   * What the store system needs out of `/stat`, memoised on the values.
   *
   * Memoised because it is handed to an effect: a fresh object per render would
   * re-announce the same stat on every render, and `receiveStat` fetches the
   * patch ops it does not have.
   *
   * Two fields only. The store system needs the ordered patch ids to learn about
   * another session's work, and `baseSha` so a write has an honest `parentRef` —
   * without it `PatchSync` reports every edit unsaveable. `schemaSha` /
   * `sourcesSha` / `jsonEntriesSha` are inputs to a refetch it does not do yet.
   */
  const statPatches =
    "data" in stat && stat.data ? stat.data.patches : undefined;
  const statMode = "data" in stat && stat.data ? stat.data.mode : undefined;
  /**
   * Unpublished changes the server threw away because it could not read them.
   *
   * Cleared by the next stat, because the server drains the notice when it hands
   * it over — so this changes only when `statPatches` does, and the effect that
   * feeds the stores cannot deliver it twice.
   */
  const statRemoved =
    "data" in stat && stat.data ? stat.data.removed : undefined;
  const storeStat = useMemo(
    () =>
      baseSha !== undefined && statPatches !== undefined
        ? { baseSha, patches: statPatches, removed: statRemoved }
        : null,
    [baseSha, statPatches, statRemoved],
  );

  const getDirectFileUploadSettings = useCallback(async (): Promise<
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

  /**
   * The store system. One per Studio, built here.
   *
   * Here rather than inside `ValStoreProvider` because this component's own body
   * reads it — the unsaved-edit count below, publish and discard, the error
   * surfaces — and a system created in a child is created below the component
   * that has to use it. `ValStoreProvider` puts it in context and feeds it.
   *
   * ONE system, for the life of the provider.
   *
   * `mode` is deliberately NOT a dependency, even though it configures the
   * system: it arrives from `/stat`, which lands after the first render, so
   * memoising on it built the system twice. The first one had already taken the
   * project in and attached its listeners — which happens at construction, so
   * nothing detached them — and its `PatchSync` retry loop kept running against
   * a system nobody could reach. Any patch created in that window went with it.
   *
   * It is pushed in below instead.
   */
  const system = useMemo(
    () =>
      createValSystem(client, {
        writes: true,
        uploadSettings: getDirectFileUploadSettings,
      }),
    [client, getDirectFileUploadSettings],
  );
  useEffect(() => {
    if (statMode === "fs" || statMode === "http") {
      system.setMode(statMode);
    }
  }, [system, statMode]);

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
  // Read from the local `system` rather than through `useSchemas()`: the context
  // that hook reads is provided by this component's own return value.
  const schemas = useSyncExternalStore(
    useCallback(
      (onChange: () => void) =>
        system.schemaStore.events.on("schema:init", onChange),
      [system],
    ),
    useCallback(() => system.schemaStore.all(), [system]),
    useCallback(() => system.schemaStore.all(), [system]),
  );
  useEffect(() => {
    if (schemas) {
      const schemasData = schemas;
      let requiresRemoteFiles = false;
      for (const schema of Object.values(schemasData)) {
        /**
         * Caught, because this is the same function the SERVER uses to decide
         * whether a publish needs remote credentials, and there it must throw on
         * a schema type it does not know — returning `false` would let a publish
         * drop remote files silently. Here the cost of throwing is the whole
         * Studio, and all that is at stake is whether to fetch remote settings.
         * So: log it, and carry on as if this schema wanted nothing remote.
         */
        try {
          if (hasRemoteFileSchema(schema)) {
            requiresRemoteFiles = true;
            break;
          }
        } catch (err) {
          console.error(
            "Val: could not tell whether a schema needs remote files. Remote " +
              "uploads may be unavailable.",
            err,
          );
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

  /**
   * Intake and `/stat` are `ValStoreProvider`'s, below.
   *
   * There used to be ~100 lines here: an init state machine, a retry timer and a
   * 1s poll that re-issued `/schema`, `/sources` and `/patches` on every tick.
   * None of it is needed any more, and the reason is where the data comes from.
   *
   * The Studio is handed the host app's `ValModules` as a prop, so schema and
   * committed source are already in this process — `host.receive` derives both,
   * with no round trip and nothing to retry. What is genuinely remote is the
   * patch chain, and `/stat` already announces it: `StatStore` names the ordered
   * ids and `PatchStore` fetches only the ones it does not have. `useStat` still
   * polls, because that is how a second editor's work arrives; nothing else does.
   */
  const [publishSummaryState, setPublishSummaryState] =
    useState<PublishSummaryState>({
      type: "not-asked",
    });

  /**
   * Warn before leaving with edits that have not reached the server.
   *
   * The engine counted queued OPERATIONS here, most of which were reads it had
   * issued itself — so a slow `/sources` fetch was enough to make the browser ask
   * "are you sure you want to leave". This counts unsaved PATCHES, which is the
   * only thing a user can actually lose by closing the tab.
   */
  const unsavedCount = useSyncExternalStore(
    useCallback(
      (onChange: () => void) =>
        system.patchStore.events.on("patch:chain", onChange),
      [system],
    ),
    useCallback(() => system.patchStore.pendingPatchIds().length, [system]),
    useCallback(() => system.patchStore.pendingPatchIds().length, [system]),
  );
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (unsavedCount > 0) {
        event.preventDefault();
        event.returnValue = ""; // Required for Chrome and some other browsers
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [unsavedCount]);
  const { state: profilesData, retry: retryProfiles } = useProfilesData(
    client,
    authenticationState,
    "data" in stat && stat.data ? stat.data.mode : "unknown",
    serviceUnavailable,
    runtimeConfig?.project,
  );

  return (
    <ValContext.Provider
      value={{
        client,
        publishSummaryState,
        setPublishSummaryState,
        profileId: "data" in stat && stat.data ? stat.data.profileId : null,
        mode: "data" in stat && stat.data ? stat.data.mode : "unknown",
        profileAuthError:
          profilesData.status === "auth-error" ? profilesData.error : null,
        profilesError:
          profilesData.status === "error"
            ? { message: profilesData.error, willRetry: profilesData.willRetry }
            : null,
        retryProfiles,
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
        subscribeToWsMessages,
        sendWsMessage,
        isWsConnected,
        aiAuthError,
        aiConnectionError,
        retryAiConnection,
        aiGetSessions,
        aiGetSessionMessages,
        aiSetSessionName,
        aiSessionImagesToPatchFile,
      }}
    >
      <TooltipProvider>
        {/*
          Configured and connected are two different questions, and the studio
          answers them in two different places: whether to offer an assistant at
          all, and whether an affordance that needs a live conversation can do
          anything yet.
        */}
        <AIChatActionsProvider
          isAIChatEnabled={wsEnabled}
          isAIChatOnline={wsEnabled && isWsConnected}
        >
          {theme !== undefined && setTheme ? (
            <ValThemeProvider
              theme={theme}
              setTheme={setTheme}
              config={runtimeConfig}
            >
              <ValStoreProvider
                system={system}
                valModules={valModules ?? null}
                stat={storeStat}
              >
                <ValErrorProvider>
                  <AutoPublishProvider>
                    <ValPortalProvider>
                      <ValRemoteProvider remoteFiles={remoteFiles}>
                        <ValFieldProvider
                          getDirectFileUploadSettings={
                            getDirectFileUploadSettings
                          }
                          config={runtimeConfig}
                        >
                          {/*
                          Tell the host page when a module's source moves, so the
                          customer's own components behind the Studio show the
                          edit rather than the committed value.
                        */}
                          <ValOverlayEmitter enabled={dispatchValEvents} />
                          <LocalModulesErrorBanner />
                          {children}
                          <SchemaOutOfDateGate />
                        </ValFieldProvider>
                      </ValRemoteProvider>
                    </ValPortalProvider>
                  </AutoPublishProvider>
                </ValErrorProvider>
              </ValStoreProvider>
            </ValThemeProvider>
          ) : (
            children
          )}
        </AIChatActionsProvider>
      </TooltipProvider>
    </ValContext.Provider>
  );
}

/**
 * The schema on the server no longer matches the one this Studio holds.
 *
 * Once true it stays true — see `SchemaFreshness` in `StatusStore`. There is no
 * way back without a reload, because every open field was resolved against a
 * schema that has been replaced, and a gate that could flicker off would let the
 * user keep editing against one that is gone.
 */
function SchemaOutOfDateGate() {
  const status = useValStatus();
  if (status.schema !== "out-of-date") return null;
  return <SchemaOutOfDateDialog />;
}

/**
 * Everything the editor is TOLD: errors, the network, the schema's freshness.
 *
 * One subscription for all of them, because `StatusStore` emits one event for
 * all of them — a UI shows them together, and splitting them into four
 * subscriptions would be four re-renders for one piece of news.
 */
function useValStatus(): StatusSnapshot {
  const val = useValSystem();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      return val.system.status.events.on("status:change", onChange);
    },
    [val],
  );
  const getSnapshot = useCallback(
    () => (val === null ? EMPTY_STATUS : val.system.status.current()),
    [val],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const EMPTY_STATUS: StatusSnapshot = {
  errors: [],
  networkErrorSince: null,
  schemaError: null,
  schema: "current",
};

/**
 * How many times a failing `/profiles` is tried before it gives up.
 *
 * It used to be unbounded — a fixed two second retry, forever. Against a
 * misconfigured project (`/profiles` answering 404 "Project not found") that is
 * not resilience: the request will never succeed, and the only thing the retry
 * produces is a console filling with the same stack every two seconds, which
 * buries every other error in the studio.
 */
const PROFILES_MAX_ATTEMPTS = 5;
/** The wait after the first failure. Doubled after each one after that. */
const PROFILES_RETRY_BASE_MS = 1000;

type ProfilesData =
  | { status: "not-asked" }
  | { data?: Record<AuthorId, Profile>; status: "loading" }
  | {
      data?: Record<AuthorId, Profile>;
      status: "error";
      error: string;
      /** Whether another attempt is already scheduled. */
      willRetry: boolean;
    }
  | { data?: Record<AuthorId, Profile>; status: "auth-error"; error: string }
  | { data: Record<AuthorId, Profile>; status: "done" };

function useProfilesData(
  client: ValClient,
  authenticationState: AuthenticationState,
  mode: "http" | "fs" | "unknown",
  serviceUnavailable: boolean | undefined,
  project: string | undefined,
): { state: ProfilesData; retry: () => void } {
  const [profilesData, setProfilesData] = useState<ProfilesData>({
    status: "not-asked",
  });
  /**
   * How many times this has been tried since the last success or manual retry.
   *
   * A ref rather than state: it is read inside the request that increments it,
   * and rendering has nothing to say about it — what the UI shows is the status
   * and whether another attempt is coming, both of which are in state.
   */
  const attempts = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);
  useEffect(() => clearRetry, [clearRetry]);

  // Through a ref so a failure can schedule the next attempt without the
  // callback having to name itself.
  const loadProfilesRef = useRef<() => void>(() => undefined);
  const loadProfiles = useCallback(async () => {
    attempts.current += 1;
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
      attempts.current = 0;
      setProfilesData({
        status: "done",
        data: profilesById,
      });
    } else if (mode === "fs" && res.status === 401) {
      const message =
        "message" in res.json && typeof res.json.message === "string"
          ? res.json.message
          : "Could not authenticate while getting profiles";
      setProfilesData((prev) => ({
        status: "auth-error",
        error: message,
        data: "data" in prev ? prev.data : undefined,
      }));
    } else {
      const willRetry = attempts.current < PROFILES_MAX_ATTEMPTS;
      if (!willRetry) {
        // Logged once, when there is nothing left to try — not on every
        // attempt, which is what made this the loudest thing in the console.
        console.error("Could not get profiles", res.json);
      }
      setProfilesData((prev) => ({
        status: "error",
        error: readableProfilesError(res.json),
        willRetry,
        data: "data" in prev ? prev.data : undefined,
      }));
      if (willRetry) {
        // Backing off rather than a fixed interval: a server that is briefly
        // busy recovers in the first second or two, and one that is
        // misconfigured is not going to answer differently on the fifth ask.
        const delay = PROFILES_RETRY_BASE_MS * 2 ** (attempts.current - 1);
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          loadProfilesRef.current();
        }, delay);
      }
    }
  }, [client, mode]);
  loadProfilesRef.current = () => void loadProfiles();

  /** Start again from the first attempt, because someone asked. */
  const retry = useCallback(() => {
    clearRetry();
    attempts.current = 0;
    loadProfilesRef.current();
  }, [clearRetry]);

  useEffect(() => {
    if (
      authenticationState === "not-asked" ||
      authenticationState === "loading"
    ) {
      return;
    }
    if (mode !== "fs" && authenticationState !== "authorized") {
      return;
    }
    if (mode === "fs" && !project) {
      return;
    }
    if (serviceUnavailable) {
      return;
    }
    // Only the first ask. Retries are the timer's job, and a manual one is the
    // retry callback's — an effect that re-fires on every status change cannot
    // tell "try again" from "the status changed because we tried".
    if (profilesData.status !== "not-asked") {
      return;
    }
    loadProfiles();
  }, [
    authenticationState,
    loadProfiles,
    mode,
    profilesData.status,
    serviceUnavailable,
    project,
  ]);

  return { state: profilesData, retry };
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
/**
 * Add a patch to any module, from outside a field.
 *
 * `useAddPatch` is the hook a field uses and is bound to that field's path and
 * instance; this is for the callers that are not fields — the AI writer, a bulk
 * action. No `creatorId`, so nothing is suppressed and every reader of the paths
 * it touches is woken, which is right: an edit that did not come from a field on
 * screen has no instance to leave asleep.
 */
export function useAddModuleFilePatch() {
  const val = useValSystem();
  const addModuleFilePatch = useCallback(
    (
      moduleFilePath: ModuleFilePath,
      patch: Patch,
      type: SerializedSchema["type"],
    ) => {
      // `type` existed so the engine could decide whether two consecutive
      // patches were mergeable. Nothing merges any more — one patch per edit —
      // so it is unused. Kept in the signature because the call sites pass it.
      void type;
      if (val === null) {
        console.error("Val: cannot write patch: no store system is mounted");
        return;
      }
      void val.system.patchStore
        .createPatch(moduleFilePath, patch)
        .then((res) => {
          if (res.status !== "created") {
            console.error("Val: could not write patch", res.message);
          }
        });
    },
    [val],
  );
  return { addModuleFilePatch };
}

export function useDeletePatches() {
  const val = useValSystem();
  const deletePatches = useCallback(
    (patchIds: PatchId[]) => {
      if (val === null) {
        console.error("Val: cannot discard: no store system is mounted");
        return;
      }
      // In batches of 100: the ids go into the request URL as query params, and
      // a chain long enough to matter is long enough to exceed a URL limit.
      for (let i = 0; i < patchIds.length; i += 100) {
        const batch = patchIds.slice(i, i + 100);
        void val.system.discard(batch).then((res) => {
          if (res.status === "failed") {
            console.error("Val: could not discard patches", res.message);
          }
        });
      }
    },
    [val],
  );
  return { deletePatches };
}

export function useAIContext() {
  const {
    subscribeToWsMessages,
    sendWsMessage,
    isWsConnected,
    aiAuthError,
    aiGetSessions,
    aiGetSessionMessages,
    aiSetSessionName,
    aiSessionImagesToPatchFile,
  } = useContext(ValContext);
  return {
    subscribeToWsMessages,
    sendWsMessage,
    isWsConnected,
    aiAuthError,
    aiGetSessions,
    aiGetSessionMessages,
    aiSetSessionName,
    aiSessionImagesToPatchFile,
  };
}

export function useDeployments() {
  const { deployments, dismissDeployment, observedCommitShas } =
    useContext(ValContext);
  return { deployments, dismissDeployment, observedCommitShas };
}

/**
 * The patch-set grouping, for the review UI.
 *
 * ON DEMAND, and that is the difference from the engine. The engine maintained
 * the grouping incrementally on every keystroke, so typing paid for a structure
 * only the review screen ever looked at. `system.getPatchSets()` builds it when
 * asked and appends to it when the chain has only grown — see `PatchSetChain`,
 * which decides append against rebuild with a prefix test rather than by
 * remembering which moments require a reset.
 *
 * Asynchronous for the same reason: the grouping is in the worker realm, so
 * there is no synchronous answer to give.
 */
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
  const val = useValSystem();
  const chainVersion = useChainVersion();
  const [state, setState] = useState<
    | { status: "success"; data: SerializedPatchSet }
    | { status: "error"; error: string }
    | { status: "not-asked" }
  >({ status: "not-asked" });

  /**
   * The last answer, serialized, so an unchanged one keeps its identity.
   *
   * `chainVersion` bumps for every movement of the chain — a save landing, a
   * stat arriving, a patch being marked published — and most of those do not
   * change the GROUPING at all. Handing back a fresh object each time made the
   * compare view recompute its change trees in the worker and rebuild every row,
   * which is what "it re-does the whole thing" and the blinking were.
   */
  const lastSerialized = useRef<string | null>(null);

  useEffect(() => {
    if (val === null) {
      return;
    }
    let cancelled = false;
    void val.system
      .getPatchSets()
      .then((data) => {
        if (cancelled) return;
        const serialized = JSON.stringify(data);
        if (serialized === lastSerialized.current) {
          // Same grouping. Not merely an optimisation: replacing the object is
          // what makes everything downstream treat it as news.
          return;
        }
        lastSerialized.current = serialized;
        setState({ status: "success", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // `chainVersion` is the dependency that matters: the grouping is a function
    // of the chain, so it is re-read exactly when the chain moves.
  }, [val, chainVersion]);

  return state;
}

/** Moved by every change to the patch chain. See `PatchStore`'s `bump`. */
function useChainVersion(): number {
  const val = useValSystem();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      return val.system.patchStore.events.on("patch:chain", onChange);
    },
    [val],
  );
  const getSnapshot = useCallback(
    () => (val === null ? 0 : val.system.patchStore.chainVersion()),
    [val],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Increments on every successful publish.
 *
 * Views that render state derived from the pending patches - the compare view
 * above all - are stale the moment a publish goes through: the patches they
 * were showing are committed and the base they were diffed against has moved.
 * Use this as a reload key so they rebuild from scratch instead of leaving the
 * pre-publish result on screen.
 */
export function usePublishCount(): number {
  const val = useValSystem();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (val === null) return;
    // `patch:forget-published` is the moment a publish has actually landed and
    // the chain has been trimmed — after the source promotion, so a view that
    // rebuilds on this key rebuilds against the new base rather than the old.
    return val.system.patchStore.events.on("patch:head", () => {
      setCount((previous) => previous + 1);
    });
  }, [val]);
  return count;
}

/**
 * Patches in the chain that have already shipped in a commit.
 *
 * Only possible in `http` mode: there a published patch stays on the server and
 * is re-applied, so being in the chain and having shipped are different facts.
 * In `fs` mode a published patch is deleted, so this is always empty.
 */
export function useCommittedPatches(): ReadonlySet<PatchId> {
  const val = useValSystem();
  const chainVersion = useChainVersion();
  return useMemo(() => {
    const committed = new Set<PatchId>();
    if (val === null) return committed;
    void chainVersion;
    for (const record of val.system.patchStore.allRecords()) {
      if (record.appliedAt) {
        committed.add(record.patchId);
      }
    }
    return committed;
  }, [val, chainVersion]);
}

/**
 * Patches the server has that this session did not create.
 *
 * Another editor's work, or this editor's from a previous session. Named
 * "server-side" by the engine, which kept three separate id lists and had a hook
 * for each; the store keeps ONE ordered chain and marks which entries are still
 * unsaved, so the three lists are three filters of one list.
 */
export function usePendingServerSidePatchIds(): PatchId[] {
  const val = useValSystem();
  const chainVersion = useChainVersion();
  return useMemo(() => {
    if (val === null) return [];
    void chainVersion;
    const store = val.system.patchStore;
    return store
      .allRecords()
      .map((record) => record.patchId)
      .filter((patchId) => !store.isPending(patchId));
  }, [val, chainVersion]);
}

/** Patches created here that have not reached the server yet. */
export function usePendingClientSidePatchIds(): PatchId[] {
  const val = useValSystem();
  const chainVersion = useChainVersion();
  return useMemo(() => {
    if (val === null) return [];
    void chainVersion;
    return val.system.patchStore.pendingPatchIds();
  }, [val, chainVersion]);
}

/**
 * Whether the editor has caught up with the server's pending changes, ONCE.
 *
 * Latched: it flips false → true when the first stat's patches have all been
 * loaded and applied, and never goes back. Later fetches are not this — by then
 * the editor holds a value and a field showing it is showing the truth, so
 * dimming the whole editor every time a patch arrives from another tab would be
 * a flicker with no information in it.
 *
 * What it is for: on the first paint a field can be showing PUBLISHED content
 * while a pending change to it is still in flight. Typing over that produces a
 * "fix" for something that was never wrong, and the real value lands underneath
 * it a moment later. So the fields are held — dimmed and inert — until this is
 * true.
 */
export function useInitialPatchesApplied(): boolean {
  const val = useValSystem();
  const chainVersion = useChainVersion();
  const [settled, setSettled] = useState(false);
  const ready =
    settled ||
    (val !== null &&
      // `void`, not a dependency: the version is the wake-up, the store is the
      // answer.
      (void chainVersion, val.system.patchStore.chainSettled()));
  useEffect(() => {
    if (ready) setSettled(true);
  }, [ready]);
  return ready;
}

/**
 * Every patch in the chain, in order.
 *
 * The engine assembled this from three id lists and de-duplicated the overlap;
 * the store has one ordered chain, so this is that chain.
 */
/**
 * What is still outstanding in the loaded chain, and why, on demand.
 *
 * A getter rather than state: it is only read when the wait has already gone on
 * too long — see `PendingChangesGate` — and as reactive state it would re-render
 * the editor on every chain change to feed a report nobody is looking at.
 */
export function usePendingChangesProgress(): () => ChainProgress {
  const val = useValSystem();
  return useCallback(() => {
    if (val === null) {
      return {
        total: 0,
        settled: 0,
        unfetched: [],
        unapplied: [],
        failed: [],
        statSeen: false,
      };
    }
    return val.system.patchStore.chainProgress();
  }, [val]);
}

/**
 * The last reason fetching patches failed, latched.
 *
 * Latched rather than cleared on success, because it is read after the fact: a
 * chain that stalled sixty seconds ago and has since had one failing round is
 * still explained by that round's message.
 */
export function usePatchFetchError(): string | null {
  const val = useValSystem();
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (val === null) return;
    return val.system.patchStore.events.on("patch:fetch-failed", (event) => {
      setMessage(event.message);
    });
  }, [val]);
  return message;
}

export function useCurrentPatchIds(): PatchId[] {
  const val = useValSystem();
  const chainVersion = useChainVersion();
  return useMemo(() => {
    if (val === null) return [];
    void chainVersion;
    return val.system.patchStore.allRecords().map((record) => record.patchId);
  }, [val, chainVersion]);
}

export type PendingPatch = {
  moduleFilePath: ModuleFilePath;
  patch: Patch;
  isPending: boolean;
  createdAt: string;
  authorId: string | null;
  isCommitted?: {
    commitSha: string;
  };
};
export function usePendingPatches(
  sourcePath: SourcePath | ModuleFilePath,
): PendingPatch[] | null {
  const val = useValSystem();
  const chainVersion = useChainVersion();
  return useMemo((): PendingPatch[] | null => {
    if (val === null) return null;
    void chainVersion;
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath);
    const store = val.system.patchStore;
    const patches: PendingPatch[] = [];
    for (const record of store.allRecords()) {
      if (record.moduleFilePath !== moduleFilePath) continue;
      // A module-level path matches every patch in the module; a deeper one
      // matches only the ops that touch it.
      const matches =
        !modulePath ||
        record.patch.some(
          (op) => Internal.patchPathToModulePath(op.path) === modulePath,
        );
      if (matches) {
        patches.push(toPendingPatch(record, store.isPending(record.patchId)));
      }
    }
    return patches;
  }, [val, chainVersion, sourcePath]);
}

export function usePendingPatchesForModule(
  moduleFilePath: ModuleFilePath,
): PendingPatch[] {
  const val = useValSystem();
  const chainVersion = useChainVersion();
  return useMemo((): PendingPatch[] => {
    if (val === null) return [];
    void chainVersion;
    const store = val.system.patchStore;
    return store
      .allRecords()
      .filter((record) => record.moduleFilePath === moduleFilePath)
      .map((record) => toPendingPatch(record, store.isPending(record.patchId)));
  }, [val, chainVersion, moduleFilePath]);
}

/**
 * A chain record in the shape the review UI reads.
 *
 * `createdAt` and `authorId` are optional on a `PatchRecord` — the chain does
 * not need them to apply a patch — but a review row has to show something, so
 * the defaults are here rather than at every call site.
 */
function toPendingPatch(record: PatchRecord, isPending: boolean): PendingPatch {
  return {
    moduleFilePath: record.moduleFilePath,
    patch: record.patch,
    isPending,
    createdAt: record.createdAt ?? "",
    authorId: record.authorId ?? null,
    isCommitted: record.appliedAt ?? undefined,
  };
}

export function useValMode(): "http" | "fs" | "unknown" {
  const { mode } = useContext(ValContext);
  return mode;
}

/**
 * Re-exported from `ValFieldProvider`, which is where the store-backed one
 * lives. Two copies of this existed — an identical body in each file — and both
 * were imported around the app.
 */
export { useLoadingStatus, type LoadingStatus } from "./ValFieldProvider";

/**
 * Has the project been taken in? Re-derived here rather than imported, because
 * `ValFieldProvider` keeps its copy private and this file's callers are outside
 * a field.
 */
function useInitialized(): number | null {
  const val = useValSystem();
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
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Moved by every source change anywhere in the project. */
function useSourcesVersion(): number {
  const val = useValSystem();
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
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
    client,
    publishSummaryState,
    setPublishSummaryState,
    config: runtimeConfig,
  } = useContext(ValContext);
  const val = useValSystem();
  const globalServerSidePatchIds = useCurrentPatchIds();
  const { patchErrors } = useAllPatchErrors();
  const hasPatchErrors = useMemo(() => {
    if (patchErrors) {
      return Object.values(patchErrors).some(
        (forModule) => Object.keys(forModule).length > 0,
      );
    }
    return false;
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
        runtimeConfig?.project,
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
      if (val === null) {
        return { status: "error", message: "No store system is mounted" };
      }
      setIsPublishing(true);
      /**
       * One retry for `chain-moved`, and no more.
       *
       * The gate refuses when an edit lands while it is validating, because what
       * it checked is then not what would be published. That race is with the
       * user's own last keystroke — they typed, then clicked Save — so the
       * honest response is to run the gate again rather than to report a
       * failure they cannot act on. Bounded, so a project being edited from
       * another tab cannot spin here.
       */
      const attempt = async (): Promise<PublishResult> => {
        const first = await val.system.publish(
          globalServerSidePatchIds,
          summary,
        );
        if (first.status === "refused" && first.reason === "chain-moved") {
          return val.system.publish(globalServerSidePatchIds, summary);
        }
        return first;
      };
      return attempt()
        .then((res) => {
          if (res.status === "published") {
            deleteSummaryStateFromLocalStorage(runtimeConfig?.project);
            setPublishSummaryState((prev) => ({
              type: "not-asked",
              isGenerating: prev.isGenerating,
            }));
          } else if (res.status === "refused") {
            // Said out loud rather than swallowed: a publish button that does
            // nothing and reports nothing is how a user comes to believe their
            // work has shipped.
            const said = describePublishRefusal(res);
            val.system.status.reportError(said.message, said.details);
          } else if (res.status === "failed") {
            val.system.status.reportError(
              "Could not publish",
              res.patchErrors
                ? Object.entries(res.patchErrors)
                    .map(([patchId, message]) => `${patchId}: ${message}`)
                    .join("\n")
                : res.message,
            );
          }
          return res;
        })
        .finally(() => {
          setIsPublishing(false);
        });
    },
    [
      val,
      globalServerSidePatchIds,
      isPublishing,
      runtimeConfig?.project,
      setPublishSummaryState,
    ],
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
        saveSummaryStateInLocalStorage(publishSummary, runtimeConfig?.project);
        return publishSummary;
      });
    },
    [globalServerSidePatchIds, setPublishSummaryState, runtimeConfig?.project],
  );
  return {
    publish,
    /**
     * The engine kept a `publishDisabled` flag that it set on entering publish
     * and cleared on the way out, and a caller could not tell why it was set.
     * There are only two reasons: a publish is running, or something in the
     * chain cannot be published. Both are already known here.
     */
    publishDisabled: isPublishing || hasPatchErrors === true,
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
  dateTime: string;
  color: string;
  file: {
    path: string;
    mimeType?: string;
  };
  image: {
    path: string;
    width?: number;
    height?: number;
    mimeType?: string;
    alt?: string;
    hotspot?: { x: number; y: number };
  };
  literal: string;
  richtext: unknown[];
}>;

export function useCurrentProfile() {
  const { profileId, profiles, mode } = useContext(ValContext);
  if (profileId) {
    return profiles[profileId] ?? null;
  }
  if (mode === "fs") {
    const [firstProfile] = Object.values(profiles);
    return firstProfile ?? null;
  }
  return null;
}

/**
 * How long the chain must sit still before auto-save writes it.
 *
 * A trailing edge, not a rate limit: the timer restarts on every chain
 * movement, so a burst of typing produces one save at the end of it rather than
 * one per keystroke. Long enough that a normal pause between words does not
 * trigger it, short enough that stopping to look at the page writes what you
 * just typed.
 */
const AUTO_SAVE_DEBOUNCE_MS = 700;

type AutoPublishContextValue = {
  autoPublish: boolean;
  setAutoPublish: (next: boolean) => void;
};

/**
 * Shared, and that is the fix rather than an implementation detail.
 *
 * `useAutoPublish` used to hold its own `useState` per call site, and it has
 * three: the toggle in the tools menu, the Save button that disables itself when
 * it is on, and the draft-changes list that hides itself. Toggling it in one
 * updated only that one — the button stayed enabled, the list stayed open — and
 * each copy ALSO ran the publish effect, so every chain movement fired three
 * concurrent publishes of the same patches. Two of them were refused as
 * `already-publishing` and dropped on the floor, which is the only reason it
 * ever looked like it worked.
 */
const AutoPublishContext = createContext<AutoPublishContextValue>({
  autoPublish: false,
  setAutoPublish: () => {},
});

const AUTO_PUBLISH_STORAGE_KEY = "val-auto-publish";

/**
 * Write every pending change to disk on a pause in typing, without a summary.
 *
 * `fs` mode only — it is the dev-server workflow, where "publish" means writing
 * the `.val.ts` files on disk and there is nothing to write a commit message
 * for. Kept in `localStorage` because it is a preference of the person editing,
 * not of the project.
 */
export function AutoPublishProvider({ children }: { children: ReactNode }) {
  const val = useValSystem();
  const mode = useValMode();
  const [autoPublish, setAutoPublishState] = useState(() => {
    try {
      return localStorage.getItem(AUTO_PUBLISH_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  /**
   * Only what the server already has.
   *
   * A patch still in the write queue cannot be published — `/save` reads the
   * store on disk — and naming it would just shorten the prefix `publish`
   * takes. It goes in the next round, which is one debounce away.
   */
  const savedPatchIds = usePendingServerSidePatchIds();

  /**
   * The batch that just failed, so it is not tried again unchanged.
   *
   * A failed `/save` reports per-patch errors, and recording them bumps the
   * chain — which is what `savedPatchIds` is memoised on, so the effect re-runs
   * with an identical batch and publishes it again 700 ms later. Nothing in
   * `publish` stops that: it gates on validation errors, not on a previous
   * refusal from the server. The result was one `POST /save` and one toast every
   * 700 ms, forever, with nobody typing.
   *
   * Cleared on any outcome that is not a failure, and a changed chain gives a
   * different key on its own — so this holds back the identical retry and
   * nothing else. The next keystroke tries again, which is the right trigger:
   * the batch is different by then.
   */
  const failedBatch = useRef<string | null>(null);

  /**
   * Save on a PAUSE, not on the chain moving.
   *
   * The previous version ran on every chain movement, which for a field being
   * typed into is once per patch: a `POST /save` per keystroke, each one
   * rewriting the `.val.ts` files. `savedPatchIds` changes identity whenever the
   * chain does, so the effect re-runs and the timer restarts — a trailing-edge
   * debounce for free, and the cleanup means a torn-down provider cannot fire.
   */
  useEffect(() => {
    if (!autoPublish || mode !== "fs" || val === null) {
      return;
    }
    if (savedPatchIds.length === 0) {
      return;
    }
    const batch = savedPatchIds.join(",");
    if (failedBatch.current === batch) {
      // Already tried, exactly as it stands, and it failed. Waiting for the
      // chain to change is the only thing that can make a difference — see
      // `failedBatch`.
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void val.system
        .publish(savedPatchIds, undefined, { exact: true })
        .then((res) => {
          if (cancelled) {
            return;
          }
          if (res.status === "failed") {
            failedBatch.current = batch;
            val.system.status.reportError(
              "Changes could not be saved to disk.",
              res.message,
            );
            return;
          }
          failedBatch.current = null;
          if (res.status === "published") {
            /*
             * Everything is on disk and nothing new has arrived: the moment to
             * check the whole project.
             *
             * The per-save gate only validates the modules the batch touched,
             * which is what keeps typing cheap — but a break that belongs to no
             * single module's patches, or a module nobody has opened, is invisible
             * to it. Skipped when the chain has already moved on: another save is
             * coming, and a whole-project pass in front of it in the worker queue
             * is the lag this design exists to avoid.
             */
            if (val.system.patchStore.allRecords().length === 0) {
              void val.system.validateEverything();
            }
          }
          /*
           * Every other outcome is silent, deliberately.
           *
           * `refused: validation-errors` is the gate working, and the fields
           * already show the errors — a toast per pause in typing would be the
           * loudest possible way to say something the screen is saying already.
           * `already-publishing`, `chain-moved` and `nothing-to-publish` all
           * mean the next pause handles it.
           */
        });
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [autoPublish, mode, val, savedPatchIds]);

  const value = useMemo<AutoPublishContextValue>(
    () => ({
      autoPublish,
      setAutoPublish: (next: boolean) => {
        setAutoPublishState(next);
        try {
          localStorage.setItem(AUTO_PUBLISH_STORAGE_KEY, next.toString());
        } catch {
          // A browser with storage disabled still gets the setting, just not
          // across reloads.
        }
      },
    }),
    [autoPublish],
  );

  return (
    <AutoPublishContext.Provider value={value}>
      {children}
    </AutoPublishContext.Provider>
  );
}

export function useAutoPublish(): AutoPublishContextValue {
  return useContext(AutoPublishContext);
}

/**
 * Whether a whole-project validation is running.
 *
 * Worth showing: it is the one validation the editor did not ask for, it can
 * take a moment on a large project, and "checking everything" is a different
 * thing to be told than "saved".
 */
export function useFullValidationRunning(): boolean {
  const val = useValSystem();
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (val === null) {
      return;
    }
    return val.system.validationStore.events.on(
      "validation:full-pass",
      (event) => {
        setRunning(event.running);
      },
    );
  }, [val]);
  return running;
}

export function useGlobalTransientErrors() {
  const val = useValSystem();
  const status = useValStatus();
  return {
    globalTransientErrors: status.errors,
    removeGlobalTransientErrors: (ids: string[]) => {
      val?.system.status.dismissErrors(ids);
    },
  };
}

export function useGlobalError():
  | { type: "network-error"; networkError: number }
  | { type: "schema-error"; schemaError: number }
  | { type: "profiles-auth-error"; error: string }
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
  const { remoteFiles, profileAuthError } = useContext(ValContext);
  const status = useValStatus();
  if (status.networkErrorSince !== null) {
    return {
      type: "network-error" as const,
      // The timestamp the network started failing, not a count: the banner
      // shows how long it has been down, and a number that only goes up would
      // reset that every time another request failed.
      networkError: status.networkErrorSince,
    };
  }
  if (status.schemaError !== null) {
    return {
      type: "schema-error" as const,
      // Rendered as a reload key rather than read: the caller only needs it to
      // change when the error does.
      schemaError: status.schemaError.length,
    };
  }
  if (profileAuthError !== null) {
    return {
      type: "profiles-auth-error" as const,
      error: profileAuthError,
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

/**
 * Patches the server refused, per patch id.
 *
 * A patch can apply here and still be rejected by `/save`: the client applies to
 * evaluated JSON with JSONOps, the server applies to the `.val.ts` AST, and the
 * two can genuinely disagree (a `c.image` metadata key that is not literally
 * present, a non-literal initializer). So a server-reported failure never
 * resolves itself and the publish gate has to read it.
 *
 * Recorded by `system.publish` when `/save` names them.
 */
export function useAllPatchErrors(): {
  patchErrors:
    | Record<ModuleFilePath, Record<PatchId, PatchErrorEntry>>
    | undefined;
} {
  const val = useValSystem();
  const status = useValStatus();
  return useMemo(() => {
    if (val === null) return { patchErrors: undefined };
    void status;
    return { patchErrors: val.system.patchErrors() };
  }, [val, status]);
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

/**
 * Why the assistant is unavailable, and how to ask again.
 *
 * `null` while it is connecting or still retrying. Only once the studio has
 * given up is there anything a person can do about it — see
 * `useAIWebSocket` — and a chat panel that offers a composer while nothing is
 * listening is worse than one that says so.
 */
export function useAIConnectionError(): {
  message: string;
  retry: () => void;
} | null {
  const { aiAuthError, aiConnectionError, retryAiConnection } =
    useContext(ValContext);
  return useMemo(() => {
    if (aiAuthError) {
      return {
        message: "You are not signed in to the assistant",
        retry: retryAiConnection,
      };
    }
    if (aiConnectionError !== null) {
      return { message: aiConnectionError, retry: retryAiConnection };
    }
    return null;
  }, [aiAuthError, aiConnectionError, retryAiConnection]);
}

export function useProfilesByAuthorId() {
  const { profiles } = useContext(ValContext);
  return profiles;
}

/**
 * Why the profiles could not be loaded, and how to ask again.
 *
 * `null` while it is working or still trying. Only once the studio has given up
 * is there anything for a person to do about it, and only then is there anything
 * worth putting on screen — a message that appears and disappears while a retry
 * loop runs is noise, not information.
 */
export function useProfilesError(): {
  message: string;
  retry: () => void;
} | null {
  const { profilesError, retryProfiles } = useContext(ValContext);
  return useMemo(
    () =>
      profilesError === null || profilesError.willRetry
        ? null
        : { message: profilesError.message, retry: retryProfiles },
    [profilesError, retryProfiles],
  );
}

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
  SchemaType extends SerializedSchema["type"],
>(
  moduleFilePaths: ModuleFilePath[],
  type: SchemaType,
): ShallowSourcesOf<SchemaType> {
  const val = useValSystem();
  const initializedAt = useInitialized();
  const sourcesVersion = useSourcesVersion();
  const sourcesRes = useMemo(() => {
    if (val === null) return null;
    void sourcesVersion;
    // Read out of the store rather than subscribed to per module: the callers
    // are whole-list views (a nav tree, a route list) that already re-render on
    // any source change, and one subscription per module would be one wake per
    // module for a single keystroke.
    return (moduleFilePaths ?? []).map((moduleFilePath) =>
      val.system.sourceStore.moduleSource(moduleFilePath),
    );
  }, [val, sourcesVersion, moduleFilePaths]);
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
      if (source === undefined) {
        // Recorded and skipped. The engine skipped it too, but by leaving a HOLE
        // in the array it was building — so every module after a missing one was
        // read at the wrong index and mapped to the wrong path. Reading is
        // positional here, so an absent module can simply be left out; callers
        // only walk `data` when the status is `success`, which a missing module
        // rules out.
        notFoundPaths.push(moduleFilePath);
        continue;
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
      !("path" in source) ||
      typeof source.path !== "string"
    ) {
      return {
        status: "error",
        error: `Expected object with a path property, got ${typeof source}`,
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

type AuthorId = string;
export type Profile = {
  fullName: string;
  email?: string; // TODO: required in the future
  avatar: {
    url: string;
  } | null;
};
