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

  const syncState = useCallback(
    (
      sourceState: string,
      requestedSources: ModuleFilePath[],
      patchIds: PatchId[],
      newPatches?: {
        path: ModuleFilePath;
        patch: Patch;
        seqNumber: number;
      }[],
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
      client("/tree/~", "PUT", {
        path: path,
        query: {
          validate_sources: true,
          validate_all: false,
          validate_binary_files: false,
        },
        body: {
          patchIds: patchIds,
          addPatches: newPatches?.sort((a, b) => a.seqNumber - b.seqNumber),
        },
      })
        .then((res) => {
          for (const moduleFilePathS of requestedSources) {
            const moduleFilePath = moduleFilePathS as ModuleFilePath;
            if (
              newPatches &&
              res.status === 409 // conflict we try again
            ) {
              setPendingPatches((prev) => {
                const patches: typeof prev = {};
                for (const newPatch of newPatches) {
                  patches[newPatch.path] = [
                    newPatch,
                    ...(prev[newPatch.path] ?? []),
                  ];
                }
                return patches;
              });
            }
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
            setSchemas({
              status: "success",
              data: res.json,
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

  const [pendingPatches, setPendingPatches] = useState<
    Record<ModuleFilePath, { patch: Patch; seqNumber: number }[]>
  >({});
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
              const sources: typeof prev = { ...prev };
              sources[moduleFilePath] = {
                ...prev[moduleFilePath],
                data: patchRes.value,
              };
              return sources;
            }
            // if we fail, we do not optimistically update, we could extend this to also not send the patch (since it should / would fail)
          }
        }
        return prev;
      });
      setPendingPatches((prev) => {
        const patches: typeof prev = { ...prev };
        patches[moduleFilePath] = [
          ...(prev[moduleFilePath] ?? []),
          { patch, seqNumber: patchSeqNumberRef.current++ },
        ];
        return patches;
      });
    },
    [sources, currentPatchIds, sourceState],
  );
  useEffect(() => {
    if (sourceState === undefined) {
      return;
    }

    const pendingPatchesModuleFilePaths = Object.keys(pendingPatches);
    const hasPatches = pendingPatchesModuleFilePaths.length > 0;
    if (hasPatches) {
      setPendingPatches({});
      setRequestedSources([]);
      const newPatches: {
        path: ModuleFilePath;
        patch: Patch;
        seqNumber: number;
      }[] = [];
      for (const moduleFilePathS of pendingPatchesModuleFilePaths) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        // we remove any requested source since we are about to fetch source for current state any ways:
        if (!requestedSources.includes(moduleFilePath)) {
          requestedSources.push(moduleFilePath);
        }
        for (const { patch, seqNumber } of pendingPatches[moduleFilePath]) {
          newPatches.push({
            path: moduleFilePath as ModuleFilePath,
            patch,
            seqNumber,
          });
        }
      }
      syncState(sourceState, requestedSources, currentPatchIds, newPatches);
    } else if (requestedSources.length > 0) {
      setRequestedSources([]); // we load all requested - if there is only 1 we load it individually, but if there are more we load them all
      syncState(sourceState, requestedSources, currentPatchIds);
    } else {
      const staleModules = [];
      for (const moduleFilePathS in currentStateRef.current) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        if (currentStateRef.current[moduleFilePath] !== sourceState) {
          staleModules.push(moduleFilePath);
        }
      }
      console.log("Stale modules", staleModules, currentStateRef.current);
      if (staleModules.length > 0) {
        syncState(sourceState, staleModules, currentPatchIds);
      }
    }
  }, [requestedSources, sourceState, currentPatchIds]);

  console.log(patchSeqNumberRef.current, JSON.stringify(pendingPatches));

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
