import { ModuleFilePath } from "@valbuild/core";
import { useMemo } from "react";
import {
  useAllSources,
  useSchemas,
  useLoadingStatus,
} from "./ValFieldProvider";
import { getReferencedFiles } from "./getReferencedFiles";

export function useReferencedFiles(
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
      schemas.data !== undefined
    ) {
      return getReferencedFiles(schemas.data, allSources, parentPath, keyValue);
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
