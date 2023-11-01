import { SourcePath, Internal, ModuleId, ValApi } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { PatchJSON } from "@valbuild/core/patch";
import { useCallback, useEffect, useState } from "react";

export type PatchCallback = (modulePath: string) => Promise<PatchJSON>;

export type InitPatchCallback = (
  currentPath: SourcePath
) => (callback: PatchCallback) => void;

export type PatchCallbackState = {
  [path: SourcePath]: () => Promise<PatchJSON>;
};

export function usePatch(paths: SourcePath[], api: ValApi) {
  const [state, setState] = useState<PatchCallbackState>({});

  const initPatchCallback: InitPatchCallback = useCallback(
    (currentPath: SourcePath) => {
      return (callback: PatchCallback) => {
        const patchPath = Internal.createPatchJSONPath(
          Internal.splitModuleIdAndModulePath(currentPath)[1]
        );
        setState((prev) => {
          return {
            ...prev,
            [currentPath]: () => callback(patchPath),
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
    ).then(() => {});
  }, [state]);

  return { initPatchCallback, onSubmitPatch };
}
