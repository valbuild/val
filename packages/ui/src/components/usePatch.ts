import {
  SourcePath,
  Internal,
  ModuleId,
  ValApi,
  PatchId,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { Patch } from "@valbuild/core/patch";
import { useCallback, useEffect, useState } from "react";
import { ValSession, ValStore } from "@valbuild/shared/internal";
import { type Remote } from "../utils/Remote";

export type PatchCallback = (patchPath: string[]) => Promise<Patch>;

export type InitPatchCallback = (
  paths: SourcePath[]
) => (callback: PatchCallback) => void;

export type PatchCallbackState = {
  [path: SourcePath]: () => Promise<Patch>;
};

export function usePatchSubmit(
  paths: SourcePath[],
  api: ValApi,
  valStore: ValStore,
  onSubmit: (refreshRequired: boolean) => void,
  session: Remote<ValSession>
) {
  const [state, setState] = useState<PatchCallbackState>({});
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState<
    "ready" | "create_patch" | "patching" | "on_submit" | "update_store"
  >("ready");

  const initPatchCallback: InitPatchCallback = useCallback(
    (paths: string[]) => {
      return (callback: PatchCallback) => {
        setState((prev) => {
          const nextState = paths.reduce((acc, path) => {
            const patchPath = Internal.createPatchPath(
              Internal.splitModuleIdAndModulePath(path as SourcePath)[1]
            );
            return {
              ...acc,
              [path]: () => callback(patchPath),
            };
          }, {} as PatchCallbackState);
          return {
            ...prev,
            ...nextState,
          };
        });
      };
    },
    []
  );
  useEffect(() => {
    setState((prev) => {
      const newState: PatchCallbackState = {};
      // filter out paths that no longer are selected
      for (const path of paths) {
        if (prev[path]) {
          newState[path] = prev[path];
        }
      }
      if (Object.keys(newState).length === Object.keys(prev).length) {
        // avoid infinite loops
        return prev;
      }
      return newState;
    });
  }, [paths]);

  const onSubmitPatch = useCallback(async () => {
    setError(null);
    setProgress("create_patch");
    const patches: Record<ModuleId, Patch> = {};

    for (const path in state) {
      const [moduleId] = Internal.splitModuleIdAndModulePath(
        path as SourcePath
      );
      const patch = await state[path as SourcePath]();
      patches[moduleId] = patch;
    }
    return maybeStartViewTransition(() => {
      setProgress("patching");
      return Promise.all(
        Object.entries(patches).map(([moduleId, patch]) =>
          api.postPatches(moduleId as ModuleId, patch).then((res) => {
            if (result.isErr(res)) {
              throw res.error;
            } else {
              res.value;
            }
          })
        )
      )
        .then(() => {
          setProgress("on_submit");
          const refreshRequired =
            session.status === "success" && session.data.mode === "proxy";
          return onSubmit(refreshRequired);
        })
        .then(() => {
          setProgress("update_store");
          return valStore.update(
            paths.map(
              (path) =>
                Internal.splitModuleIdAndModulePath(path as SourcePath)[0]
            )
          );
        });
    })
      .catch((err) => {
        setError(err);
      })
      .finally(() => {
        setProgress("ready");
      });
  }, [state, session]);

  return { initPatchCallback, onSubmitPatch, error, progress };
}

async function maybeStartViewTransition(f: () => Promise<void>) {
  if (
    "startViewTransition" in document &&
    typeof document.startViewTransition === "function"
  ) {
    await document.startViewTransition(f);
  }
  await f();
}

export function usePatches(session: Remote<ValSession>, api: ValApi) {
  const [patches, setPatches] = useState<Record<ModuleId, PatchId[]>>({});
  const [patchResetId, setPatchResetId] = useState(0);

  useEffect(() => {
    if (session.status === "success") {
      api.getPatches({}).then((patchRes) => {
        if (result.isOk(patchRes)) {
          const patchesByModuleId: Record<ModuleId, PatchId[]> = {};
          for (const moduleId in patchRes.value) {
            patchesByModuleId[moduleId as ModuleId] = patchRes.value[
              moduleId as ModuleId
            ].map((patch) => patch.patch_id);
          }
          setPatches(patchesByModuleId);
        } else {
          console.error("Could not load patches", patchRes.error);
        }
      });
    }
  }, [session, patchResetId]);

  return { patches, setPatchResetId };
}
