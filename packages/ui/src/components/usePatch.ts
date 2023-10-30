import { SourcePath, Internal } from "@valbuild/core";
import { PatchJSON } from "@valbuild/core/patch";
import { useCallback, useEffect, useState } from "react";
import { PatchCallback } from "./ValFormField";

export function usePatch(path: SourcePath | null) {
  const [state, setState] = useState<{
    [path: SourcePath]: () => Promise<PatchJSON>;
  }>({});
  const initPatchCallback = useCallback((currentPath: SourcePath | null) => {
    return (callback: PatchCallback) => {
      // TODO: revaluate this logic when we have multiple paths
      // NOTE: see cleanup of state in useEffect below
      if (!currentPath) {
        setState({});
      } else {
        const patchPath = Internal.createPatchJSONPath(
          Internal.splitModuleIdAndModulePath(currentPath)[1]
        );
        setState((prev) => {
          return {
            ...prev,
            [currentPath]: () => callback(patchPath),
          };
        });
      }
    };
  }, []);
  useEffect(() => {
    setState((prev) => {
      return Object.fromEntries(
        Object.entries(prev).filter(([currPath]) => currPath === path)
      );
    });
  }, [path]);

  return { initPatchCallback, state };
}
