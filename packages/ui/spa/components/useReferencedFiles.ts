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
} from "./useJsonValuesLoad";

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
  /**
   * The sources the scan walks: current, except while the content it needs
   * is landing, when they move on in tenths of the load.
   *
   * The scan walks the whole project. A load of 10,000 `.jsonValues()`
   * entries lands in a few hundred batches, and a walk per batch was most of
   * a second of work per second of loading, on the thread the editor types
   * on. The places found so far are still shown as it goes, ten times, and
   * the answer that gates a delete or a rename is the one after the last
   * batch, from the sources as they are then.
   */
  const step =
    scan.status === "loading" ? Math.floor(scan.percentage / 10) : null;
  const scannedSources = useMemo(
    () => allSources,
    // `allSources` only when not loading: see above.
    [step, step === null ? allSources : null],
  );
  const referencingSourcePaths = useMemo(() => {
    if (
      parentPath !== undefined &&
      "data" in schemas &&
      schemas.data !== undefined
    ) {
      return getReferencedFiles(
        schemas.data,
        scannedSources,
        parentPath,
        keyValue,
      );
    }
    return [];
  }, [
    loadingStatus,
    scannedSources,
    "data" in schemas && schemas.data,
    parentPath,
    keyValue,
  ]);
  return withReferences(scan, referencingSourcePaths);
}
