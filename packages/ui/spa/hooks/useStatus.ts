import { Patch } from "@valbuild/core/patch";
import type { ModuleFilePath, PatchId } from "@valbuild/core";
import { ValClient, ValCommit, ValDeployment } from "@valbuild/shared/internal";
import React, {
  useState,
  useEffect,
  useRef,
  SetStateAction,
  Dispatch,
  useCallback,
} from "react";
import { z } from "zod";

const PatchId = z
  .string()
  .uuid()
  .refine((p): p is PatchId => true);

const WebSocketServerMessage = z.union([
  z.object({
    type: z.literal("patches"),
    patches: z.array(PatchId),
  }),
  z.object({
    type: z.literal("deployment"),
    deployment: ValDeployment,
  }),
  z.object({
    type: z.literal("commit"),
    commit: ValCommit,
  }),
  z.object({
    type: z.literal("subscribed"),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    reconnect: z.boolean().optional(),
  }),
]);

const StatData = z.object({
  type: z.union([
    z.literal("did-change"),
    z.literal("no-change"),
    z.literal("request-again"),
    z.literal("use-websocket"),
  ]),
  profileId: z.string().nullable(),
  config: z.object({
    project: z.string().optional(),
    files: z
      .object({
        directory: z.string(),
      })
      .optional(),
  }),
  commitSha: z.string().optional(), // Only use-websocket has this (refactor this zod schema?)
  sourcesSha: z.string(),
  schemaSha: z.string(),
  baseSha: z.string(),
  patches: z.array(PatchId),
  commits: z.array(ValCommit).optional(),
  deployments: z.array(ValDeployment).optional(),
  mode: z.union([z.literal("fs"), z.literal("http")]),
});
type StatData = z.infer<typeof StatData>;

export type StatState =
  | {
      status: "not-asked";
    }
  | {
      status: "initializing";
    }
  | {
      status: "updated-request-again";
      data: StatData;
      waitStart: number;
      wait: number;
    }
  | {
      status: "updating";
      data: StatData;
    }
  | {
      status: "ws-message-received";
      data: StatData;
      waitStart: number;
      wait: number;
    }
  | {
      status: "error";
      data?: StatData;
      isAuthenticationError?: boolean;
      error: string;
      retries: number;
      waitStart: number;
      wait: number;
    };
export function useStatus(client: ValClient) {
  // this is where we handle the base state of the application:
  // if the schema or the commit changes, we must reload the schema (and the sources)
  // if base changes, we must fetch sources (with patches applied, and errors)
  // if patches changes, we must fetch sources (applied with patches, and errors) and patch data

  // the base state changes by calling /stat, then deciding what to do:
  // if we are in dev mode, the /stat end point will block until there is a change so we immediately call /stat again on completion
  // if we are in prod mode, the /stat end point returns immediately with the base state, but we also get a websocket url to listen to patches

  const [stat, setStat] = useState<StatState>({
    status: "not-asked",
  });

  const webSocketRef = useRef<WebSocket | null>(null);
  const {
    authenticationState,
    setAuthenticationLoadingIfNotAuthenticated,
    setIsAuthenticated,
  } = useAuthentication();
  const [serviceUnavailable, setServiceUnavailable] = useState<
    boolean | boolean
  >();

  const statIdRef = useRef(0);
  useEffect(() => {
    if (
      stat.status === "updated-request-again" ||
      stat.status === "error" ||
      stat.status === "ws-message-received"
    ) {
      if (stat.wait === 0) {
        console.debug(
          "Executing stat immediately",
          stat.status,
          stat.status === "error" ? stat.error : "no error",
          "Now:",
          Date.now()
        );
        execStat(
          client,
          webSocketRef,
          statIdRef,
          stat,
          setStat,
          setAuthenticationLoadingIfNotAuthenticated,
          setIsAuthenticated,
          setServiceUnavailable
        );
      } else {
        console.debug(
          "Executing stat in ",
          stat.wait,
          " status: ",
          stat.status,
          "Now:",
          Date.now()
        );
        const timeout = setTimeout(() => {
          execStat(
            client,
            webSocketRef,
            statIdRef,
            stat,
            setStat,
            setAuthenticationLoadingIfNotAuthenticated,
            setIsAuthenticated,
            setServiceUnavailable
          );
        }, stat.wait);
        return () => clearTimeout(timeout);
      }
    }
  }, [client, stat]);

  useEffect(() => {
    if (stat.status === "not-asked") {
      setStat({
        status: "initializing",
      });
      console.debug("Initializing stat");
      execStat(
        client,
        webSocketRef,
        statIdRef,
        stat,
        setStat,
        setAuthenticationLoadingIfNotAuthenticated,
        setIsAuthenticated,
        setServiceUnavailable
      );
    }
  }, [client, stat.status]);

  return [
    stat,
    setStat,
    authenticationState,
    setAuthenticationLoadingIfNotAuthenticated,
    setIsAuthenticated,
    serviceUnavailable,
  ] as const;
}

const WebSocketStatInterval = 10 * 1000;
async function execStat(
  client: ValClient,
  webSocketRef: React.MutableRefObject<WebSocket | null>,
  statIdRef: React.MutableRefObject<number>,
  stat: StatState,
  setStat: Dispatch<SetStateAction<StatState>>,
  setAuthenticationLoadingIfNotAuthenticated: () => void,
  setIsAuthenticated: Dispatch<SetStateAction<AuthenticationState>>,
  setServiceUnavailable: Dispatch<SetStateAction<boolean | undefined>>
) {
  const id = ++statIdRef.current;
  let body = null;
  if ("data" in stat && stat.data) {
    body = {
      schemaSha: stat.data.schemaSha,
      sourcesSha: stat.data.sourcesSha,
      baseSha: stat.data.baseSha,
      patches: stat.data.patches,
    };
  }

  setAuthenticationLoadingIfNotAuthenticated();
  return client("/stat", "POST", {
    body: body,
  })
    .then((res) => {
      if (res.status === 401) {
        setIsAuthenticated("login-required");
        return;
      } else {
        setIsAuthenticated("authorized");
      }
      if (res.status === 503) {
        setServiceUnavailable(true);
        setStat((prev) => ({
          status: "error",
          error: "Service unavailable",
          retries: ("retries" in prev ? prev.retries : 0) + 1,
          waitStart: Date.now(),
          wait: 5000,
        }));
        return;
      }
      setServiceUnavailable(false);
      if (statIdRef.current !== 0 && statIdRef.current !== id) {
        return;
      }
      if (res.status === 200) {
        if (
          // we could have less types on json, but these are supposed to be more descriptive
          res.json.type === "did-change" ||
          res.json.type === "no-change" ||
          res.json.type === "request-again"
        ) {
          setStat({
            status: "updated-request-again",
            data: res.json,
            waitStart: Date.now(),
            wait: webSocketRef.current ? WebSocketStatInterval : 0, // why 0 wait unless websocket? If websocket is not used, we are long polling so no point in waiting
          });
        } else if (res.json.type === "use-websocket") {
          setStat((prev) => ({
            ...prev,
            status: "updated-request-again",
            data: res.json,
            waitStart: Date.now(),
            wait: WebSocketStatInterval,
          }));
          if (webSocketRef.current) {
            console.debug("Closing existing WebSocket");
            webSocketRef.current.close();
          }
          const wsUrl = res.json.url;
          console.debug("Connecting to WebSocket", wsUrl);
          webSocketRef.current = new WebSocket(wsUrl);
          const nonce = res.json.nonce;
          webSocketRef.current.onopen = () => {
            webSocketRef.current?.send(
              JSON.stringify({ nonce, type: "subscribe" })
            );
          };
          webSocketRef.current.onmessage = (event) => {
            try {
              const messageRes = WebSocketServerMessage.safeParse(
                JSON.parse(event.data)
              );
              if (!messageRes.success) {
                console.error(
                  "Could not parse WebSocket message",
                  messageRes.error
                );
                return;
              }
              const message = messageRes.data;
              if (message.type === "error") {
                setStat((prev) => createError(prev, message.message));
              } else if (message.type === "patches") {
                setStat((prev) => {
                  if ("data" in prev && prev.data) {
                    return {
                      status: "ws-message-received",
                      data: {
                        ...prev.data,
                        patches: message.patches,
                      },
                      waitStart:
                        "waitStart" in prev ? prev.waitStart : Date.now(),
                      wait:
                        "waitStart" in prev
                          ? Math.max(0, Date.now() - prev.waitStart)
                          : WebSocketStatInterval,
                    };
                  }
                  return prev;
                });
              } else if (message.type === "subscribed") {
                console.debug("Subscribed!");
              } else if (message.type === "commit") {
                console.debug("Commit", message.commit);
                setStat((prev) => {
                  if ("data" in prev && prev.data) {
                    // we don't want to set the wait time to 0 here, because we want to keep the polling
                    return {
                      status: "ws-message-received",
                      data: {
                        ...prev.data,
                        commits: (prev.data.commits || []).concat(
                          message.commit
                        ),
                      },
                      waitStart:
                        "waitStart" in prev ? prev.waitStart : Date.now(),
                      wait:
                        "waitStart" in prev
                          ? Math.max(0, Date.now() - prev.waitStart)
                          : WebSocketStatInterval,
                    };
                  }
                  return prev;
                });
              } else if (message.type === "deployment") {
                console.debug("Deployment", message.deployment);
                setStat((prev) => {
                  if ("data" in prev && prev.data) {
                    return {
                      status: "ws-message-received",
                      data: {
                        ...prev.data,
                        deployments: (prev.data.deployments || []).concat({
                          commitSha: message.deployment.commitSha,
                          deploymentId: message.deployment.deploymentId,
                          deploymentState: message.deployment.deploymentState,
                          createdAt: message.deployment.createdAt,
                          updatedAt: message.deployment.updatedAt,
                        }),
                      },
                      waitStart:
                        "waitStart" in prev ? prev.waitStart : Date.now(),
                      wait:
                        "waitStart" in prev
                          ? Math.max(0, Date.now() - prev.waitStart)
                          : WebSocketStatInterval,
                    };
                  }
                  return prev;
                });
              } else {
                const exhaustiveCheck: never = message;
                console.warn("Unknown WebSocket message", exhaustiveCheck);
              }
            } catch (e) {
              console.error("Could not parse WebSocket message", e);
            }
          };
          const currentWebSocket = webSocketRef.current;
          webSocketRef.current.onclose = () => {
            if (currentWebSocket === webSocketRef.current) {
              console.debug("WebSocket closed");
              setStat((prev) => createError(prev, "WebSocket closed"));
            }
          };
          webSocketRef.current.onerror = () => {
            console.warn("WebSocket error");
            setStat((prev) =>
              createError(
                prev,
                `Got an error while syncing with Val (reason: WebSocket error)`
              )
            );
          };
        }
      } else {
        setStat((prev) => createError(prev, res.json.message));
      }
    })
    .catch((err) => {
      if (statIdRef.current !== 0 && statIdRef.current !== id) {
        return;
      }
      setStat((prev) => createError(prev, err.message));
    });
}

function createError(stat: StatState, message: string): StatState {
  const retries = "retries" in stat ? stat.retries + 1 : 0;
  // a bit of random jitter in the start, but maxes out pretty soon on 5000ms
  const waitMillis =
    stat.status === "error" && stat.retries > 1
      ? Math.min(500, stat.retries * 50 + Math.floor(Math.random() * 100)) * 10
      : 0;

  return {
    status: "error",
    error: message,
    data: "data" in stat ? stat.data : undefined,
    retries,
    waitStart: "waitStart" in stat ? stat.waitStart : Date.now(),
    wait: waitMillis,
  };
}

export type AuthenticationState =
  | "not-asked"
  | "loading"
  | "login-required"
  | "authorized"
  | "authentication-error";
function useAuthentication() {
  const [authenticationState, setIsAuthenticated] =
    useState<AuthenticationState>("not-asked");
  const setAuthenticationLoadingIfNotAuthenticated = useCallback(() => {
    if (authenticationState === "not-asked") {
      setIsAuthenticated("loading");
    }
  }, [authenticationState]);

  return {
    authenticationState,
    setIsAuthenticated,
    setAuthenticationLoadingIfNotAuthenticated,
  };
}

export type PatchWithMetadata = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  patch: Patch;
  author: string | null;
  createdAt: string;
  error: string | null;
};

export type Author = {
  id: string;
  name: string;
  avatar: string;
};

export type ValError =
  | {
      type: "validationError";
      message: string;
    }
  | {
      type: "patchError";
      message: string;
    }
  | {
      // should the UI be responsible for "handling" errors? That makes sense right now, but not sure if it will in the future
      type: "typeError" | "schemaError" | "unknownError";
      message: string;
    };
