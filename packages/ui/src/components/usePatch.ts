import { SourcePath, Internal, ModuleId, ValApi } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { PatchJSON } from "@valbuild/core/patch";
import { useCallback, useEffect, useState } from "react";
import { IValStore } from "../exports";
import { ValSession } from "@valbuild/shared/internal";
import { Remote } from "../utils/Remote";

export type PatchCallback = (modulePath: string) => Promise<PatchJSON>;

export type InitPatchCallback = (
  currentPath: SourcePath
) => (callback: PatchCallback) => void;

export type PatchCallbackState = {
  [path: SourcePath]: () => Promise<PatchJSON>;
};

export function usePatch(
  paths: SourcePath[],
  api: ValApi,
  valStore: IValStore,
  onSubmit: (refreshRequired: boolean) => void,
  session: Remote<ValSession>
) {
  const [state, setState] = useState<PatchCallbackState>({});
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState<
    "ready" | "create_patch" | "patching" | "on_submit" | "update_store"
  >("ready");

  const initPatchCallback: InitPatchCallback = useCallback(
    (pathsAttr: string) => {
      return (callback: PatchCallback) => {
        setState((prev) => {
          const paths = pathsAttr.split(",");
          const nextState = paths.reduce((acc, path) => {
            const patchPath = Internal.createPatchJSONPath(
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
    const patches: Record<ModuleId, PatchJSON> = {};
    for (const path in state) {
      const [moduleId] = Internal.splitModuleIdAndModulePath(
        path as SourcePath
      );
      const patch = await state[path as SourcePath]();
      patches[moduleId] = patch;
    }
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
        const refreshRequired =
          session.status === "success" && session.data.mode === "proxy";
        onSubmit(refreshRequired);
      })
      .then(() => {
        return valStore.update(
          paths.map(
            (path) => Internal.splitModuleIdAndModulePath(path as SourcePath)[0]
          )
        );
      });
  }, [state, session]);

  return { initPatchCallback, onSubmitPatch };
}
