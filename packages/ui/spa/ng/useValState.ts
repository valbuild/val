import { applyPatch, JSONOps, JSONValue, Patch } from "@valbuild/core/patch";
import type {
  ModuleFilePath,
  SerializedSchema,
  Json,
  SourcePath,
  PatchId,
} from "@valbuild/core";
import { ValClient } from "@valbuild/shared/internal";
import React, {
  useState,
  useEffect,
  useRef,
  SetStateAction,
  Dispatch,
  useCallback,
} from "react";
import { Remote } from "../utils/Remote";
import { UpdatingRemote, PatchWithMetadata, ValError } from "./ValProvider";
import { z } from "zod";

const ops = new JSONOps();
export function useValState(client: ValClient) {
  const [schemas, setSchemas] = useState<
    Remote<Record<ModuleFilePath, SerializedSchema>>
  >({
    status: "not-asked",
  });
  const [sources, setSources] = useState<
    Record<ModuleFilePath, UpdatingRemote<Json>>
  >({});
  const [patchData, setPatchData] = useState<
    Record<PatchId, Remote<PatchWithMetadata>>
  >({});
  const [sourcePathErrors, setSourcePathErrors] = useState<
    Record<SourcePath, UpdatingRemote<ValError[]>>
  >({});
  const [stat, setStat] = useStat(client);

  const addPatch = useCallback(
    (moduleFilePath: ModuleFilePath, patch: Patch) => {
      const currentSource =
        sources[moduleFilePath] &&
        "data" in sources[moduleFilePath] &&
        sources[moduleFilePath].data;
      console.log("currentSource", currentSource);
      let didFail = false;
      if (currentSource) {
        // optimistic update if source is available - source should typically be available
        const patchRes = applyPatch(currentSource as JSONValue, ops, patch);
        if (patchRes.kind === "ok") {
          setSources((prev) => {
            const sources = { ...prev };
            sources[moduleFilePath] = {
              status: "updating",
              data: patchRes.value,
            };
            return sources;
          });
        } else {
          didFail = true;
          setSourcePathErrors((prev) => {
            const errors = { ...prev };
            errors[moduleFilePath as unknown as SourcePath] = {
              status: "success",
              data: [
                {
                  type: "patchError",
                  message: `Could not apply patch (${patchRes.error.message})`,
                },
              ],
            };
            return errors;
          });
        }
      }
      if (didFail) {
        return;
      }
      client("/tree/~", "PUT", {
        path: moduleFilePath,
        query: {
          validate_sources: true,
          validate_all: false,
          validate_binary_files: false,
        },
        body: {
          addPatch: {
            path: moduleFilePath,
            patch,
          },
        },
      }).then((res) => {
        if (res.status === 200) {
          setSources((prev) => {
            const sources = { ...prev };
            sources[moduleFilePath] = {
              status: "success",
              data: res.json.modules[moduleFilePath]?.source,
            };
            return sources;
          });
          setSourcePathErrors((prev) => {
            const moduleValidationErrors =
              res.json.modules[moduleFilePath]?.patches?.errors;
            const errors = { ...prev };
            for (const patchId in moduleValidationErrors) {
              console.log(
                "patchId",
                patchId,
                moduleValidationErrors[patchId as PatchId],
              );
            }
            // errors[moduleFilePath as unknown as SourcePath] = {
            //   status: "success",
            //   data: [res.json.modules[moduleFilePath]?.errors],
            // };
            return errors;
          });
          if (res.json.newPatchId) {
            const newPatchId = res.json.newPatchId;
            setStat((prev) => {
              return {
                ...prev,
                patches:
                  "data" in prev && prev.data
                    ? [...prev.data.patches, newPatchId]
                    : [newPatchId],
              };
            });
          } else {
            setSourcePathErrors((prev) => {
              const errors = { ...prev };
              errors[moduleFilePath as unknown as SourcePath] = {
                status: "success",
                data: [
                  {
                    type: "patchError",
                    message: `Could not create new patch`,
                  },
                ],
              };
              return errors;
            });
          }
        } else {
          setSourcePathErrors((prev) => {
            const errors = { ...prev };
            errors[moduleFilePath as unknown as SourcePath] = {
              status: "success",
              data: [
                {
                  type: "patchError",
                  message: `Could not create new patch`,
                },
              ],
            };
            return errors;
          });
        }
      });
    },
    [sources],
  );

  const schemaSha =
    "data" in stat && stat.data?.schemaSha ? stat.data.schemaSha : undefined;
  useEffect(() => {
    if (schemaSha) {
      setSchemas({
        status: "loading",
      });
      client("/schema", "GET", {}).then((res) => {
        if (res.status === 200) {
          if (res.json.schemaSha === schemaSha) {
            setSources((prev) => {
              const sources: Record<ModuleFilePath, UpdatingRemote<Json>> = {};
              let didChange = false;
              for (const moduleFilePathS in res.json.schemas) {
                const moduleFilePath = moduleFilePathS as ModuleFilePath;
                const status = prev[moduleFilePath]?.status;
                if (status === "not-asked") {
                  continue;
                }
                didChange = true;
                if (status === undefined) {
                  sources[moduleFilePath] = {
                    status: "not-asked",
                  };
                } else {
                  sources[moduleFilePath] = {
                    status: "requested",
                  };
                }
              }
              if (didChange) {
                return sources;
              }
              return prev;
            });
            setSchemas({
              status: "success",
              data: res.json,
            });
          } else {
            setSchemas({
              status: "error",
              error: "Schema sha mismatch",
            });
          }
        } else {
          setSchemas({
            status: "error",
            error: res.json.message,
          });
        }
      });
    }
  }, [schemaSha]);

  const maybePatchIds = "data" in stat ? stat.data?.patches : undefined;
  useEffect(() => {
    let requiredUpdateCount = 0;
    let modulesCount = 0;
    for (const moduleFilePathS in sources) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      if (
        sources[moduleFilePath].status === "requested" ||
        sources[moduleFilePath].status === "update-requested"
      ) {
        requiredUpdateCount++;
      } else {
        modulesCount++;
      }
    }
    // if all modules are requested, we can do a bulk request
    if (requiredUpdateCount > 0 && requiredUpdateCount === modulesCount) {
      setSources((prev) => {
        const sources = { ...prev };
        let didChange = false;
        for (const moduleFilePathS in sources) {
          const moduleFilePath = moduleFilePathS as ModuleFilePath;
          if (sources[moduleFilePath].status === "requested") {
            sources[moduleFilePath] = {
              status: "loading",
            };
            didChange = true;
          } else if (sources[moduleFilePath].status === "update-requested") {
            sources[moduleFilePath] = {
              status: "updating",
              data: sources[moduleFilePath].data,
            };
            didChange = true;
          }
        }
        if (didChange) {
          return sources;
        }
        return prev;
      });
      client("/tree/~", "PUT", {
        path: undefined,
        query: {
          validate_sources: true,
          validate_all: false,
          validate_binary_files: false,
        },
        body: {
          patchIds: maybePatchIds || [],
        },
      }).then((res) => {
        if (res.status === 200) {
          setSources((prev) => {
            const sources = { ...prev };
            for (const moduleFilePathS in sources) {
              const moduleFilePath = moduleFilePathS as ModuleFilePath;
              sources[moduleFilePath] = {
                status: "success",
                data: res.json.modules[moduleFilePath]?.source,
              };
            }
            return sources;
          });
        } else {
          setSources((prev) => {
            const sources = { ...prev };
            for (const moduleFilePathS in sources) {
              const moduleFilePath = moduleFilePathS as ModuleFilePath;
              sources[moduleFilePath] = {
                status: "error",
                error: res.json.message,
                data:
                  "data" in prev[moduleFilePath]
                    ? prev[moduleFilePath].data
                    : undefined,
              };
            }
            return sources;
          });
        }
      });
    } else {
      for (const moduleFilePathS in sources) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        if (
          sources[moduleFilePath].status === "requested" ||
          sources[moduleFilePath].status === "update-requested"
        ) {
          client("/tree/~", "PUT", {
            path: moduleFilePath,
            query: {
              validate_sources: true,
              validate_all: false,
              validate_binary_files: false,
            },
            body: {
              patchIds: maybePatchIds || [],
            },
          }).then((res) => {
            if (res.status === 200) {
              setSources((prev) => {
                const sources = { ...prev };
                sources[moduleFilePath] = {
                  status: "success",
                  data: res.json.modules[moduleFilePath]?.source,
                };
                return sources;
              });
            } else {
              setSources((prev) => {
                const sources = { ...prev };
                sources[moduleFilePath] = {
                  status: "error",
                  error: res.json.message,
                  data:
                    "data" in prev[moduleFilePath]
                      ? prev[moduleFilePath].data
                      : undefined,
                };
                return sources;
              });
            }
          });
        }
      }
    }
  }, [sources, maybePatchIds]);

  return {
    stat,
    schemas,
    sources,
    patchData,
    addPatch,
    sourcePathErrors,
  };
}

const PatchId = z.string().refine((p): p is PatchId => true); // TODO: validate
const WSMessage = z.object({
  patches: z.array(PatchId),
});
const StatData = z.object({
  schemaSha: z.string(),
  baseSha: z.string(),
  patches: z.array(PatchId),
});
type StatData = z.infer<typeof StatData>;

type StatState =
  | {
      status: "not-asked";
    }
  | {
      status: "initializing";
    }
  | {
      status: "updated-request-again";
      data: StatData;
      wait: number;
    }
  | {
      status: "updating";
      data: StatData;
    }
  | {
      status: "ws-message-received";
      data: StatData;
    }
  | {
      status: "error";
      data?: StatData;
      error: string;
      retries: number;
      wait: number;
    };
function useStat(client: ValClient) {
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

  const statIdRef = useRef(0);
  useEffect(() => {
    if (stat.status === "updated-request-again" || stat.status === "error") {
      if (stat.wait === 0) {
        execStat(client, webSocketRef, statIdRef, stat, setStat);
      } else {
        const timeout = setTimeout(() => {
          execStat(client, webSocketRef, statIdRef, stat, setStat);
        }, stat.wait);
        return () => clearTimeout(timeout);
      }
    }
  }, [client, stat]);

  useEffect(() => {
    setStat({
      status: "initializing",
    });
    execStat(client, webSocketRef, statIdRef, stat, setStat);
  }, [client]);

  return [stat, setStat] as const;
}

const WebSocketStatInterval = 10 * 1000;

async function execStat(
  client: ValClient,
  webSocketRef: React.MutableRefObject<WebSocket | null>,
  statIdRef: React.MutableRefObject<number>,
  stat: StatState,
  setStat: Dispatch<SetStateAction<StatState>>,
) {
  const id = ++statIdRef.current;
  let body = null;
  if ("data" in stat && stat.data) {
    body = {
      schemaSha: stat.data.schemaSha,
      baseSha: stat.data.baseSha,
      patches: stat.data.patches,
    };
  }

  return client("/stat", "POST", {
    body: body,
  })
    .then((res) => {
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
            wait: webSocketRef.current ? WebSocketStatInterval : 0, // why 0 wait unless websocket? If websocket is not used, we are long polling so no point in waiting
          });
        } else if (res.json.type === "use-websocket") {
          if (webSocketRef.current) {
            webSocketRef.current.close();
          }
          webSocketRef.current = new WebSocket(res.json.url);
          webSocketRef.current.onmessage = (event) => {
            const message = WSMessage.parse(event.data);
            setStat((prev) => {
              if ("data" in prev && prev.data) {
                return {
                  status: "ws-message-received",
                  data: {
                    ...prev.data,
                    patches: message.patches,
                  },
                };
              }
              return prev;
            });
          };
          webSocketRef.current.onclose = () => {
            webSocketRef.current = null;
          };
          webSocketRef.current.onerror = () => {
            setStat((prev) => createError(prev, "WebSocket error"));
          };
          setStat({
            status: "updated-request-again",
            data: res.json,
            wait: WebSocketStatInterval,
          });
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
    wait: waitMillis,
  };
}
