import { ModuleFilePath } from "@valbuild/core";
import { useMemo } from "react";
import { useAllSources, useSchemas } from "./ValFieldProvider";
import { useLoadingStatus } from "./ValProvider";
import { getKeysOf } from "./getKeysOf";

export function useKeysOf(
  parentPath: ModuleFilePath | undefined,
  keyValue?: string,
) {
  const schemas = useSchemas();
  const loadingStatus = useLoadingStatus();
  const allSources = useAllSources();
  const referencingModuleFilePaths = useMemo(() => {
    if (
      parentPath !== undefined &&
      "data" in schemas &&
      schemas.data !== undefined &&
      schemas.data[parentPath] !== undefined
    ) {
      return getKeysOf(schemas.data, allSources, parentPath, keyValue);
    }
    return [];
  }, [
    loadingStatus,
    allSources,
    "data" in schemas && schemas.data,
    parentPath,
    keyValue,
  ]);
  return referencingModuleFilePaths;
}
