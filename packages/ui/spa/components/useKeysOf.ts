import { ModuleFilePath } from "@valbuild/core";
import { useMemo } from "react";
import { useAllSourcesWhen, useSchemas } from "./ValFieldProvider";
import { getKeysOf } from "./getKeysOf";
import {
  ReferencesResult,
  useReferenceScanStatus,
  withReferences,
} from "./useJsonValuesLoad";

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
  /*
   * Every module's source only where there is a record to scan for: this is
   * called by `ArrayAndRecordTools`, which every field mounts, and for most
   * of them -- a string in an object -- there is nothing to scan. Read
   * unconditionally, with the write queue's status beside it, each of those
   * fields rendered for every write anywhere and again when it was saved.
   */
  const allSources = useAllSourcesWhen(parentPath !== undefined);
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
  }, [allSources, "data" in schemas && schemas.data, parentPath, keyValue]);
  // Memoised: this flows into components that put it in effect dependencies,
  // so a fresh object per render is a render loop. See `useJsonValuesLoad`.
  return useMemo(
    () => withReferences(scan, referencingSourcePaths),
    [scan, referencingSourcePaths],
  );
}
