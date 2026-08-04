import { ModuleFilePath } from "@valbuild/core";
import { useMemo } from "react";
import {
  useAllSources,
  useSchemas,
  useLoadingStatus,
} from "./ValFieldProvider";
import { getReferencedFiles } from "./getReferencedFiles";
import {
  ReferencesResult,
  useReferenceScanStatus,
  withReferences,
} from "./useReferenceScanStatus";

/**
 * The image/file fields referencing the gallery module `parentPath` (optionally
 * one specific file ref of it).
 *
 * Returns a {@link ReferencesResult}, not a bare array: the scan is blind to
 * `.jsonValues()` entry content that is not loaded, so a caller that gates a
 * delete must wait for `status === "success"` before believing the refs are
 * complete.
 */
export function useReferencedFiles(
  parentPath: ModuleFilePath | undefined,
  keyValue?: string,
): ReferencesResult {
  const schemas = useSchemas();
  const loadingStatus = useLoadingStatus();
  const allSources = useAllSources();
  const query = useMemo(
    () =>
      parentPath === undefined
        ? null
        : ({ kind: "file", module: parentPath } as const),
    [parentPath],
  );
  const scan = useReferenceScanStatus(query);
  const referencingSourcePaths = useMemo(() => {
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
  return withReferences(scan, referencingSourcePaths);
}
