import {
  applyPatch,
  deepClone,
  JSONOps,
  JSONValue,
  Patch,
} from "@valbuild/core/patch";
import type {
  ModuleFilePath,
  SerializedSchema,
  Json,
  SourcePath,
  PatchId,
  ValidationError,
} from "@valbuild/core";
import { ParentRef, ValClient } from "@valbuild/shared/internal";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Remote } from "../utils/Remote";
import { mergePatches } from "../utils/mergePatches";
import { AuthenticationState, StatState, useStatus } from "./useStatus";

const MAX_RETRIES_ON_CONFLICT = 10;

const ops = new JSONOps();

export function useValState(
  client: ValClient,
  overlayDraftMode: boolean,
): {
  stat: StatState;
  authenticationState: AuthenticationState;
  schemas: Remote<Record<ModuleFilePath, SerializedSchema>>;
  schemaSha: string | undefined;
  sources: Record<ModuleFilePath, Json | undefined>;
  addPatch: (moduleFilePath: ModuleFilePath, patch: Patch) => void;
  deletePatches: (patchIds: PatchId[]) => Promise<DeletePatchesRes>;
  patchesStatus: PatchesStatus;
  sourcesSyncStatus: SourcesSyncStatus;
  validationErrors: Record<SourcePath, ValidationError[]>;
  patchIds: PatchId[];
  serviceUnavailable: boolean | undefined;
} {
  const [requestedSources, setRequestedSources] = useState<ModuleFilePath[]>(
    [],
  );
  const [schemas, setSchemas] = useState<
    Remote<Record<ModuleFilePath, SerializedSchema>>
  >({
    status: "not-asked",
  });
  const [sourcesSyncStatus, setSourcesSyncStatus] = useState<
    Record<
      ModuleFilePath,
      | { status: "loading" }
      | {
          status: "error";
          errors: {
            message: string;
            patchId?: PatchId;
            skipped?: boolean;
          }[];
        }
    >
  >({});
  const [patchesStatus, setPatchesStatus] = useState<
    Record<
      ModuleFilePath,
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
          isAuthenticationError?: boolean;
          errors: {
            message: string;
            patchId?: PatchId;
            skipped?: boolean;
          }[];
        }
    >
  >({});
  const [sources, setSources] = useState<
    Record<ModuleFilePath, Json | undefined>
  >({});
  const [
    stat,
    setStat,
    authenticationState,
    setAuthenticationLoadingIfNotAuthenticated,
    setIsAuthenticated,
    serviceUnavailable,
  ] = useStatus(client);
  const [validationErrors, setValidationErrors] = useState<
    Record<SourcePath, ValidationError[]>
  >({});
  const pendingPatchesRef = useRef<
    Record<ModuleFilePath, { patch: Patch; seqNumber: number }[]>
  >({});
  const syncSources = useCallback(
    (sourceState: string, requestedSources: ModuleFilePath[]) => {
      // Load all sources if we have more than one.
      // We could load more modules individually, but we are uncertain what would perform best.
      // Logically this seems easier should cover the init case and whenever we need to update individual modules (e.g. after patching)
      const path =
        requestedSources.length === 1 ? requestedSources[0] : undefined;
      setRequestedSources([]);
      setRequestedSourcesToLoadingOrUpdating(requestedSources);
      const currentState = { ...currentStateRef.current };
      for (const moduleFilePath of requestedSources) {
        currentState[moduleFilePath] = sourceState;
      }
      currentStateRef.current = { ...currentState };
      const validateAll = path === undefined;
      setAuthenticationLoadingIfNotAuthenticated();
      // reset patches status for the requested sources
      setPatchesStatus((prev) => {
        const current: typeof prev = { ...prev };
        for (const moduleFilePath of requestedSources) {
          delete current[moduleFilePath];
        }
        return current;
      });
      client("/sources/~", "PUT", {
        path: path,
        query: {
          validate_sources: true,
          validate_binary_files: false,
        },
      })
        .then((res) => {
          if (res.status === 401) {
            setIsAuthenticated("login-required");
            return;
          } else {
            setIsAuthenticated("authorized");
          }
          if (res.status === 400 && !("errors" in res.json)) {
            setSourcesSyncStatus(
              Object.fromEntries(
                requestedSources.map((moduleFilePath) => [
                  moduleFilePath,
                  { status: "error", errors: [{ message: res.json.message }] },
                ]),
              ),
            );
            return;
          }
          if (res.status === 200) {
            setValidationErrors((prev) => {
              const errors: typeof prev = validateAll ? {} : { ...prev };
              for (const [moduleFilePathS, modules] of Object.entries(
                res.json.modules || {},
              )) {
                const moduleFilePath = moduleFilePathS as ModuleFilePath;
                if (modules) {
                  for (const [sourcePathS, validationErrors] of Object.entries(
                    res.json.modules[moduleFilePath]?.validationErrors || {},
                  )) {
                    const sourcePath = sourcePathS as SourcePath;
                    if (validationErrors) {
                      errors[sourcePath] = validationErrors;
                    }
                  }
                }
              }
              return errors;
            });
            for (const moduleFilePathS of requestedSources) {
              const moduleFilePath = moduleFilePathS as ModuleFilePath;
              if (
                currentState[moduleFilePath] !==
                currentStateRef.current[moduleFilePath]
              ) {
                continue;
              }
              const source = res.json.modules[moduleFilePath]?.source;
              const skippedPatches =
                res.json.modules[moduleFilePath]?.patches?.skipped;
              const patchErrors =
                res.json.modules[moduleFilePath]?.patches?.errors;
              if (source !== undefined) {
                updateSources([moduleFilePath], res.json.modules);
              }
              if (patchErrors || skippedPatches) {
                setPatchesStatus((prev) => {
                  const current: typeof prev = { ...prev };
                  for (const skippedPatch of skippedPatches || []) {
                    if (
                      !current[moduleFilePath] ||
                      current[moduleFilePath].status !== "error"
                    ) {
                      current[moduleFilePath] = {
                        status: "error",
                        errors: [],
                      };
                    }
                    const currentModule = current[moduleFilePath];
                    if (currentModule.status === "error") {
                      currentModule.errors.push({
                        skipped: true,
                        patchId: skippedPatch,
                        message: "Patch skipped",
                      });
                    }
                  }
                  for (const [patchIdS, data] of Object.entries(
                    patchErrors || {},
                  )) {
                    const patchId = patchIdS as PatchId;
                    if (
                      !current[moduleFilePath] ||
                      current[moduleFilePath].status !== "error"
                    ) {
                      current[moduleFilePath] = {
                        status: "error",
                        errors: [],
                      };
                    }
                    const currentModule = current[moduleFilePath];
                    if (currentModule.status === "error" && data) {
                      currentModule.errors.push({
                        patchId,
                        message: data.message,
                      });
                    }
                  }
                  return current;
                });
              }
            }
          } else if (res.status === 400) {
            const errors: Record<
              ModuleFilePath,
              {
                status: "error";
                errors: {
                  message: string;
                  patchId?: PatchId;
                  skipped?: boolean;
                }[];
              }
            > = {};
            for (const moduleFilePathS of requestedSources) {
              const moduleFilePath = moduleFilePathS as ModuleFilePath;
              errors[moduleFilePath] = {
                status: "error",
                errors: [{ message: res.json.message }],
              };
            }
            setSourcesSyncStatus(errors);
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
      setSourcesSyncStatus((prev) => {
        const syncStatus: typeof prev = { ...prev };
        let didChange = false;
        for (const moduleFilePathS of requestedSources) {
          const moduleFilePath = moduleFilePathS as ModuleFilePath;
          if (syncStatus[moduleFilePath]?.status !== "loading") {
            syncStatus[moduleFilePath] = { status: "loading" };
            didChange = true;
          }
        }
        if (didChange) {
          return syncStatus;
        }
        return prev;
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
        Record<
          ModuleFilePath,
          { error: { message: string }; patchId?: PatchId; skipped?: boolean }[]
        >
      >,
    ) => {
      setSources((prev) => {
        const sources: typeof prev = { ...prev };
        const moduleFilePaths = paths;

        setSourcesSyncStatus((prev) => {
          const syncStatus: typeof prev = { ...prev };
          for (const moduleFilePath of moduleFilePaths as ModuleFilePath[]) {
            if (errors && errors[moduleFilePath]) {
              syncStatus[moduleFilePath] = {
                status: "error",
                errors:
                  errors[moduleFilePath]?.map((e) => ({
                    ...e.error,
                    ...e,
                  })) ?? [],
              };
            } else {
              delete syncStatus[moduleFilePath];
            }
          }
          return syncStatus;
        });
        for (const moduleFilePathS of moduleFilePaths) {
          const moduleFilePath = moduleFilePathS as ModuleFilePath;
          // We skip if we have a pending patch for this module
          // Because we will get a new state for this module when the patch is applied
          if (pendingPatchesRef.current[moduleFilePath]) {
            continue;
          }
          if (
            newModules[moduleFilePath] !== undefined &&
            newModules[moduleFilePath]?.source !== undefined
          ) {
            sources[moduleFilePath] = newModules[moduleFilePath]?.source;
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

  const schemaSha =
    "data" in stat && stat.data?.schemaSha ? stat.data.schemaSha : undefined;
  useEffect(() => {
    if (schemaSha) {
      setSchemas({
        status: "loading",
      });
      setAuthenticationLoadingIfNotAuthenticated();
      client("/schema", "GET", {}).then((res) => {
        if (res.status === 401) {
          setIsAuthenticated("login-required");
          return;
        } else {
          setIsAuthenticated("authorized");
        }
        if (res.status === 200) {
          if (res.json.schemaSha === schemaSha) {
            const schemas: Record<ModuleFilePath, SerializedSchema> = {};
            for (const moduleFilePathS in res.json.schemas) {
              const moduleFilePath = moduleFilePathS as ModuleFilePath;
              const schema = res.json.schemas[moduleFilePath];
              if (schema) {
                schemas[moduleFilePath] = schema;
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

  useEffect(() => {
    if (
      stat.status === "error" &&
      (schemas.status === "loading" || schemas.status === "not-asked")
    ) {
      setSchemas({
        status: "error",
        error: stat.error,
      });
    }
  }, [stat, schemas]);

  useEffect(() => {
    if (overlayDraftMode) {
      for (const moduleFilePathS in sources) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        if (sources[moduleFilePath] !== undefined) {
          window.dispatchEvent(
            new CustomEvent("val-event", {
              detail: {
                type: "source-update",
                moduleFilePath,
                source: sources[moduleFilePath],
              },
            }),
          );
        }
      }
    }
  }, [overlayDraftMode, sources]);

  // Load all modules each time schema is updated
  // We do not really want to do this, but we do not have a better way to initialize the source for the moment
  useEffect(() => {
    if (schemas.status === "success") {
      setRequestedSources(Object.keys(schemas.data) as ModuleFilePath[]);
    }
  }, [schemas]);
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
        if (prev[moduleFilePath] !== undefined) {
          const currentSource = prev[moduleFilePath];
          if (currentSource !== undefined) {
            const patchableOps = patch.filter((op) => op.op !== "file");
            const patchRes = applyPatch(
              deepClone(currentSource) as JSONValue,
              ops,
              patchableOps,
            );
            if (patchRes.kind === "ok") {
              if (overlayDraftMode) {
                // send val-event to update the source
                window.dispatchEvent(
                  new CustomEvent("val-provider-overlay", {
                    detail: {
                      type: "source-update",
                      detail: {
                        moduleFilePath,
                        source: patchRes.value,
                      },
                    },
                  }),
                );
              }
              pendingPatchesRef.current = {
                ...pendingPatchesRef.current,
                [moduleFilePath]: [
                  ...(pendingPatchesRef.current[moduleFilePath] ?? []),
                  { patch, seqNumber: patchSeqNumberRef.current++ },
                ],
              };
              setPatchesStatus((prev) => {
                const current: typeof prev = { ...prev };
                current[moduleFilePath] = {
                  status: "created-patch",
                  createdAt: new Date().toISOString(),
                };
                return current;
              });
              setSourcesSyncStatus((prev) => {
                const current: typeof prev = { ...prev };
                current[moduleFilePath] = {
                  status: "loading",
                };
                return current;
              });
              const sources: typeof prev = { ...prev };
              sources[moduleFilePath] = patchRes.value;
              return sources;
            } else {
              console.error("Could not apply patch", patchRes.error);
              setPatchesStatus((prev) => {
                const current: typeof prev = { ...prev };
                current[moduleFilePath] = {
                  status: "error",
                  errors: [patchRes.error],
                };
                return current;
              });
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
    [sources, currentPatchIds, sourceState, overlayDraftMode],
  );

  const deletePatches = useCallback(
    async (patchIds: PatchId[]): Promise<DeletePatchesRes> => {
      const res = await client("/patches", "DELETE", {
        query: {
          id: patchIds,
        },
      });
      if (res.status === 200) {
        setRequestedSources([]); // reload all sources
        return { status: "ok" };
      }
      return { status: "error", error: res.json.message };
    },
    [client],
  );
  useEffect(() => {
    if (sourceState === undefined) {
      return;
    }

    if (requestedSources.length === 0) {
      const staleModules = [];
      for (const moduleFilePathS in currentStateRef.current) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        if (
          currentStateRef.current[moduleFilePath] &&
          currentStateRef.current[moduleFilePath] !== sourceState
        ) {
          staleModules.push(moduleFilePath);
        }
      }
      if (staleModules.length > 0) {
        syncSources(sourceState, staleModules);
      }
    } else {
      syncSources(sourceState, requestedSources);
    }
  }, [requestedSources, sourceState, currentPatchIds]);

  const retriesOnConflict = useRef<number | null>(null);
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
    setPatchesStatus((prev) => {
      const current: typeof prev = {};
      for (const moduleFilePathS in pendingPatches) {
        const moduleFilePath = moduleFilePathS as ModuleFilePath;
        let createdAt;
        const prevAtSourcePath = prev[moduleFilePath];
        if (prevAtSourcePath && "createdAt" in prevAtSourcePath) {
          createdAt = prevAtSourcePath.createdAt;
        } else {
          createdAt = new Date().toISOString();
        }
        current[moduleFilePath] = {
          status: "uploading-patch",
          createdAt,
          updatedAt: new Date().toISOString(),
        };
      }
      return current;
    });
    // TODO: add a /patches POST endpoint and use that instead
    setAuthenticationLoadingIfNotAuthenticated();
    if (!("data" in stat) || !stat.data) {
      console.error("Cannot add patches without stat data");
      return;
    }
    const parentRef: ParentRef =
      currentPatchIds.length > 0
        ? {
            type: "patch",
            patchId: currentPatchIds[currentPatchIds.length - 1],
          }
        : {
            type: "head",
            headBaseSha: stat.data.baseSha,
          };

    client("/patches", "PUT", {
      body: {
        patches: mergedPatches,
        parentRef,
      },
    })
      .then((res) => {
        if (res.status === 401) {
          setIsAuthenticated("login-required");
          return;
        } else {
          setIsAuthenticated("authorized");
        }
        if (res.status === 409) {
          if (
            !retriesOnConflict.current ||
            retriesOnConflict.current < MAX_RETRIES_ON_CONFLICT // max retries on conflicts
          ) {
            console.warn(
              "Conflict! Retrying. Attempts left: ",
              MAX_RETRIES_ON_CONFLICT - (retriesOnConflict.current || 1),
            );
            // retry on conflict
            retriesOnConflict.current = (retriesOnConflict.current ?? 1) + 1;
          } else {
            pendingPatchesRef.current = {}; // reset patches status
            setSourcesSyncStatus((prev) => {
              const current: typeof prev = {};
              for (const moduleFilePathS in pendingPatches) {
                const moduleFilePath = moduleFilePathS as ModuleFilePath;
                current[moduleFilePath] = {
                  status: "error",
                  errors: [
                    {
                      message:
                        "Cannot apply changes. Val is online, but it could not get the latest set of changes from the server (i.e. there's a conflict). Try reloading.",
                    },
                  ],
                };
              }
              return current;
            });
          }
        } else if (
          res.status === null &&
          res.json.type === "network_error" &&
          res.json.retryable
        ) {
          // retry on network errors
        } else {
          retriesOnConflict.current = null;
          for (const moduleFilePathS in pendingPatchesRef.current) {
            const moduleFilePath = moduleFilePathS as ModuleFilePath;
            for (const pendingPatch of pendingPatchesRef.current[
              moduleFilePath
            ]) {
              if (syncedSeqNumbers.has(pendingPatch.seqNumber)) {
                delete pendingPatchesRef.current[moduleFilePath];
              }
            }
          }
          setPatchesStatus((prev) => {
            const current: typeof prev = {};
            if ("errors" in res.json) {
              // we have an explicit error for each module
              for (const moduleFilePathS in pendingPatches) {
                const moduleFilePath = moduleFilePathS as ModuleFilePath;
                const errors = res.json.errors[moduleFilePath];
                if (errors) {
                  current[moduleFilePath] = {
                    status: "error",
                    errors: errors.map((e) => ({ ...e.error, ...e.error })),
                  };
                }
              }
            } else if (res.status !== 200) {
              // we do not know what went wrong
              for (const moduleFilePathS in pendingPatches) {
                const moduleFilePath = moduleFilePathS as ModuleFilePath;
                current[moduleFilePath] = {
                  status: "error",
                  errors: [{ message: res.json.message }],
                };
              }
            }
            return current;
          });
        }
      })
      .catch((err) => {
        console.error("Could not sync patches", err);
        // retry
      });
  }, [currentPatchIds, stat.status, "data" in stat && stat.data]);
  const timeAtLastSync = useRef(-1);
  const timeSinceLastSourcesUpdateRef = useRef(-1);
  useEffect(() => {
    timeSinceLastSourcesUpdateRef.current = Date.now();
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
  }, [sources, mergeAndSyncPatches]);

  useEffect(() => {
    const interval = setInterval(() => {
      const maybeConnectionIssues =
        // it has been N seconds since last sources update
        Date.now() - timeSinceLastSourcesUpdateRef.current > 5000 &&
        // but we still have pending patches
        Object.keys(pendingPatchesRef.current).length > 0;
      if (maybeConnectionIssues) {
        mergeAndSyncPatches();
      }
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [mergeAndSyncPatches]);

  return {
    stat,
    authenticationState,
    schemas,
    schemaSha,
    sources,
    addPatch,
    deletePatches,
    patchesStatus,
    sourcesSyncStatus,
    validationErrors,
    patchIds: currentPatchIds,
    serviceUnavailable,
  };
}

export type DeletePatchesRes =
  | { status: "ok" }
  | { status: "error"; error: string };

type PatchesStatus = Record<
  ModuleFilePath,
  | { status: "created-patch"; createdAt: string }
  | { status: "uploading-patch"; createdAt: string; updatedAt: string }
  | {
      status: "error";
      isAuthenticationError?: boolean;
      errors: {
        message: string;
        patchId?: PatchId;
        skipped?: boolean;
      }[];
    }
>;

type SourcesSyncStatus = Record<
  ModuleFilePath,
  | { status: "loading" }
  | {
      status: "error";
      errors: {
        message: string;
        patchId?: PatchId;
        skipped?: boolean;
      }[];
    }
>;
