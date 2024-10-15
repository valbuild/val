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
  useMemo,
} from "react";
import { Remote } from "../utils/Remote";
import { z } from "zod";
import { mergePatches } from "./mergePatches";

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

  const pendingPatchesRef = useRef<
    Record<ModuleFilePath, { patch: Patch; seqNumber: number }[]>
  >({});
  const syncSources = useCallback(
    (
      sourceState: string,
      requestedSources: ModuleFilePath[],
      patchIds: PatchId[],
    ) => {
      // Load all sources if we have more than one.
      // We could load more modules individually, but we are uncertain what would perform best.
      // Logically this seems easier should cover the init case and whenever we need to update individual modules (e.g. after patching)
      const path =
        requestedSources.length === 1 ? requestedSources[0] : undefined;

      setRequestedSourcesToLoadingOrUpdating(requestedSources);
      const currentState = { ...currentStateRef.current };
      for (const moduleFilePath of requestedSources) {
        currentState[moduleFilePath] = sourceState;
      }
      currentStateRef.current = { ...currentState };
      if (Object.keys(pendingPatchesRef.current).length > 0) {
        return;
      }
      client("/tree/~", "PUT", {
        path: path,
        query: {
          validate_sources: true,
          validate_all: false,
          validate_binary_files: false,
        },
        body: {
          patchIds: patchIds,
        },
      })
        .then((res) => {
          for (const moduleFilePathS of requestedSources) {
            const moduleFilePath = moduleFilePathS as ModuleFilePath;
            if (
              currentState[moduleFilePath] !==
              currentStateRef.current[moduleFilePath]
            ) {
              continue;
            }

            if (res.status === 200) {
              updateSources([moduleFilePath], res.json.modules);
              setSourcePathErrors((prev) => {
                const errors = { ...prev };
                errors[moduleFilePath as unknown as SourcePath] = {
                  status: "success",
                  data: [], // reset errors
                };
                return errors;
              });
            } else {
              const modules = "modules" in res.json ? res.json.modules : {};
              const errors = "errors" in res.json ? res.json.errors : {};
              updateSources([moduleFilePath], modules, errors);
            }
          }
        })
        .catch((err) => {
          const errorMessage =
            err instanceof Error ? err.message : JSON.stringify(err);

          updateSources(
            requestedSources,
            {},
            Object.fromEntries(
              requestedSources.map((moduleFilePath) => [
                moduleFilePath,
                [{ error: { message: errorMessage } }],
              ]),
            ),
          );
        });
    },
    [],
  );
  const setRequestedSourcesToLoadingOrUpdating = useCallback(
    (requestedSources: ModuleFilePath[]) => {
      setSources((prev) => {
        const sources: typeof prev = { ...prev };
        for (const moduleFilePathS of requestedSources) {
          const moduleFilePath = moduleFilePathS as ModuleFilePath;
          if (!sources[moduleFilePath]) {
            console.warn("Requested unknown module", moduleFilePath);
            continue;
          }
          // We skip if we have a pending patch for this module
          // Because we will get a new state for this module when the patch is applied
          if (pendingPatchesRef.current[moduleFilePath]) {
            continue;
          }
          if ("data" in sources[moduleFilePath]) {
            sources[moduleFilePath].status = "updating";
          } else {
            sources[moduleFilePath].status = "loading";
          }
        }
        return sources;
      });
    },
    [sources],
  );
  const updateSources = useCallback(
    (
      paths: string[],
      newModules: Partial<
        Record<
          ModuleFilePath,
          {
            source?: Json;
          }
        >
      >,
      errors?: Partial<
        Record<ModuleFilePath, { error: { message: string } }[]>
      >,
    ) => {
      setSources((prev) => {
        const sources: typeof prev = { ...prev };
        const moduleFilePaths = paths;
        for (const moduleFilePathS of moduleFilePaths) {
          const moduleFilePath = moduleFilePathS as ModuleFilePath;
          // We skip if we have a pending patch for this module
          // Because we will get a new state for this module when the patch is applied
          if (pendingPatchesRef.current[moduleFilePath]) {
            continue;
          }
          if (errors && errors[moduleFilePath]) {
            sources[moduleFilePath] = {
              status: "error",
              errors: errors[moduleFilePath].map((e) => e.error.message),
              data: newModules[moduleFilePath]?.source
                ? newModules[moduleFilePath].source
                : "data" in prev[moduleFilePath]
                  ? prev[moduleFilePath].data
                  : undefined,
            };
          } else if (newModules[moduleFilePath]?.source) {
            sources[moduleFilePath] = {
              status: "success",
              data: newModules[moduleFilePath].source,
            };
          }
        }
        setRequestedSources((prev) => {
          const sources = prev.filter((moduleFilePath) => {
            return moduleFilePaths.includes(moduleFilePath);
          });
          if (sources.length !== prev.length) {
            return sources;
          }
          return prev;
        });
        return sources;
      });
    },
    [],
  );
  const [requestedSources, setRequestedSources] = useState<ModuleFilePath[]>(
    [],
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
              const sources: Record<ModuleFilePath, UpdatingRemote<Json>> = {
                ...prev,
              };
              let didChange = false;
              for (const moduleFilePathS in res.json.schemas) {
                const moduleFilePath = moduleFilePathS as ModuleFilePath;
                // We skip if we have a pending patch for this module
                // Because we will get a new state for this module when the patch is applied
                if (pendingPatchesRef.current[moduleFilePath]) {
                  continue;
                }
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
                  setRequestedSources((prev) => {
                    if (prev.includes(moduleFilePath)) {
                      return prev;
                    }
                    return [...prev, moduleFilePath];
                  });
                }
              }
              if (didChange) {
                return sources;
              }
              return prev;
            });
            const schemas: Record<ModuleFilePath, SerializedSchema> = {};
            for (const moduleFilePathS in res.json.schemas) {
              const moduleFilePath = moduleFilePathS as ModuleFilePath;
              if (res.json.schemas[moduleFilePath]) {
                schemas[moduleFilePath] = res.json.schemas[moduleFilePath];
              }
            }
            setSchemas({
              status: "success",
              data: schemas,
            });
          } else {
            setSchemas({
              status: "error",
              error: "Schema (different checksums) mismatch",
            });
            // Update stat schema - should trigger new load of schemas
            setStat((prev) => {
              const stat = { ...prev, schemaSha };
              return stat;
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

  const { currentPatchIds, sourceState } = useMemo((): {
    currentPatchIds: PatchId[];
    sourceState?: string;
  } => {
    if ("data" in stat && stat.data) {
      // the sources differs only if baseSha and / or patches differ
      const sourceState = stat.data.baseSha + stat.data.patches.join(",");
      return {
        currentPatchIds: stat.data.patches,
        sourceState,
      };
    }
    return {
      currentPatchIds: [],
    };
  }, [stat]);
  const currentStateRef = useRef<Record<string, string>>({});

  const patchSeqNumberRef = useRef(0);
  const addPatch = useCallback(
    (moduleFilePath: ModuleFilePath, patch: Patch) => {
      setSources((prev) => {
        // optimistically update if source is available - source should typically be available
        if ("data" in prev[moduleFilePath]) {
          const currentSource = prev[moduleFilePath].data;
          if (currentSource) {
            const patchRes = applyPatch(
              currentSource as JSONValue,
              ops,
              patch.filter((op) => op.op !== "file"),
            );
            if (patchRes.kind === "ok") {
              pendingPatchesRef.current = {
                ...pendingPatchesRef.current,
                [moduleFilePath]: [
                  ...(pendingPatchesRef.current[moduleFilePath] ?? []),
                  { patch, seqNumber: patchSeqNumberRef.current++ },
                ],
              };
              const sources: typeof prev = { ...prev };
              sources[moduleFilePath] = {
                ...prev[moduleFilePath],
                data: patchRes.value,
              };
              return sources;
            }
          }
        } else {
          // does it make sense to add a patch to a module that is not loaded?
          console.warn(
            "Trying to patch a module that is not loaded",
            moduleFilePath,
            patch,
          );
          pendingPatchesRef.current = {
            ...pendingPatchesRef.current,
            [moduleFilePath]: [
              ...(pendingPatchesRef.current[moduleFilePath] ?? []),
              { patch, seqNumber: patchSeqNumberRef.current++ },
            ],
          };
        }
        return prev;
      });
    },
    [sources, currentPatchIds, sourceState],
  );
  useEffect(() => {
    if (sourceState === undefined) {
      return;
    }
    if (requestedSources.length > 0) {
      setRequestedSources([]); // we load all requested - if there is only 1 we load it individually, but if there are more we load them all
      syncSources(sourceState, requestedSources, currentPatchIds);
    } else {
      const staleModules = [];
      for (const moduleFilePathS in currentStateRef.current) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        if (currentStateRef.current[moduleFilePath] !== sourceState) {
          staleModules.push(moduleFilePath);
        }
      }
      if (staleModules.length > 0) {
        syncSources(sourceState, staleModules, currentPatchIds);
      }
    }
  }, [requestedSources, sourceState, currentPatchIds]);

  useEffect(() => {
    if (schemas.status === "success") {
      setRequestedSources(Object.keys(schemas.data) as ModuleFilePath[]);
    }
  }, [schemas]);

  const mergeAndSyncPatches = useCallback(() => {
    const pendingPatches = { ...pendingPatchesRef.current };
    if (Object.keys(pendingPatches).length === 0) {
      return [];
    }
    const mergedPatches = mergePatches(pendingPatches);
    const syncedSeqNumbers = new Set<number>();
    for (const moduleFilePathS in pendingPatches) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      for (const { seqNumber } of pendingPatches[moduleFilePath]) {
        syncedSeqNumbers.add(seqNumber);
      }
    }
    // TODO: add a /patches POST endpoint and use that instead
    client("/tree/~", "PUT", {
      path: undefined,
      query: {
        validate_sources: false,
        validate_all: false,
        validate_binary_files: false,
      },

      body: {
        patchIds: currentPatchIds,
        addPatches: mergedPatches,
      },
    })
      .then((res) => {
        if (res.status === 409) {
          // retry on conflict
        } else if (
          res.status === null &&
          res.json.type === "network_error" &&
          res.json.retryable
        ) {
          // retry on network errors
        } else {
          for (const moduleFilePathS in pendingPatches) {
            const moduleFilePath = moduleFilePathS as ModuleFilePath;
            pendingPatchesRef.current[moduleFilePath] = pendingPatches[
              moduleFilePath
            ].filter((p) => !syncedSeqNumbers.has(p.seqNumber));
            if (pendingPatchesRef.current[moduleFilePath].length === 0) {
              delete pendingPatchesRef.current[moduleFilePath];
            }
          }
          if ("errors" in res.json) {
            // we have an explicit error for each module
            for (const moduleFilePathS in pendingPatches) {
              const moduleFilePath = moduleFilePathS as ModuleFilePath;
              const errors = res.json.errors[moduleFilePath];
              if (errors) {
                setSourcePathErrors((prev) => {
                  const current = { ...prev };
                  current[moduleFilePath as unknown as SourcePath] = {
                    status: "error",
                    errors: errors.map((e) => e.error.message),
                  };
                  return current;
                });
              }
            }
          } else if (res.status !== 200) {
            // we do not know what went wrong
            for (const moduleFilePathS in pendingPatches) {
              const moduleFilePath = moduleFilePathS as ModuleFilePath;
              setSourcePathErrors((prev) => {
                const current = { ...prev };
                current[moduleFilePath as unknown as SourcePath] = {
                  status: "error",
                  errors: [res.json.message],
                };
                return current;
              });
            }
          }
        }
      })
      .catch((err) => {
        console.error("Could not sync patches", err);
        // retry
      });
  }, [currentPatchIds]);
  const timeAtLastSync = useRef(-1);
  useEffect(() => {
    // We want to batch patches for merging, but also to avoid hammering the server
    // In addition: we want to sync them as soon as possible
    // Lastly we never want to wait longer than N seconds before syncing if there is a patch coming in
    // if not new patches after 500ms, we sync
    // if the patches continue after 2000ms, we force a sync
    if (
      timeAtLastSync.current !== -1 &&
      Date.now() - timeAtLastSync.current > 2000
    ) {
      timeAtLastSync.current = Date.now();
      mergeAndSyncPatches();
    } else {
      const timeout = setTimeout(() => {
        timeAtLastSync.current = Date.now();
        mergeAndSyncPatches();
      }, 500);
      return () => {
        clearTimeout(timeout);
      };
    }
  }, [sources]);

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
  type: z.union([
    z.literal("did-change"),
    z.literal("no-change"),
    z.literal("request-again"),
    z.literal("use-websocket"),
  ]),
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

export type PatchWithMetadata = {
  patchId: PatchId;
  patch: Patch;
  author: Author | null;
  createdAt: string;
  error: string | null;
};

/**
 * Use this for remote data that can be updated (is changing).
 * Use Remote for data that requires a refresh to update
 */
export type UpdatingRemote<T> =
  | {
      status: "not-asked"; // no data has been requested
    }
  | {
      status: "loading"; // data is loading
    }
  | {
      status: "success"; // data has been loaded
      data: T;
    }
  | {
      status: "updating"; // updating with new data
      data: T;
    }
  | {
      status: "error"; // an error occurred
      errors: string[] | string;
      data?: T;
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
