import { ModuleFilePath } from "@valbuild/core";
import { useMemo } from "react";
import {
  useAllSources,
  useSchemas,
  useLoadingStatus,
} from "./ValFieldProvider";
import { getKeysOf } from "./getKeysOf";
import {
  ReferencesResult,
  useReferenceScanStatus,
  withReferences,
} from "./useReferenceScanStatus";

/**
 * The `s.keyOf()` fields pointing at `parentPath` (optionally at one specific
 * key of it).
 *
 * Returns a {@link ReferencesResult}, not a bare array: the scan is blind to
 * `.jsonValues()` entry content that is not loaded, so a caller that gates a
 * delete or a rename must wait for `status === "success"` before believing the
 * refs are complete.
 */
export function useKeysOf(
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
        : ({ kind: "keyOf", module: parentPath } as const),
    [parentPath],
  );
  const scan = useReferenceScanStatus(query);
  const referencingSourcePaths = useMemo(() => {
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
  return withReferences(scan, referencingSourcePaths);
}
