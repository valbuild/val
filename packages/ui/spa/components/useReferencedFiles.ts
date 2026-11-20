import { ModuleFilePath, type SourcePath } from "@valbuild/core";
import { useEffect, useMemo, useState } from "react";
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
  const painted = usePaintedOnce();
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
    if (!painted) {
      return NOT_SCANNED;
    }
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
    painted,
    loadingStatus,
    scannedSources,
    "data" in schemas && schemas.data,
    parentPath,
    keyValue,
  ]);
  if (!painted && scan.status === "success") {
    // Nothing has looked yet, so nothing may be concluded: Delete and Rename
    // wait on `success`. Said as a scan that has only just started.
    return NOT_SCANNED_YET;
  }
  return withReferences(scan, referencingSourcePaths);
}

const NOT_SCANNED: SourcePath[] = [];
const NOT_SCANNED_YET: ReferencesResult = {
  status: "loading",
  refs: NOT_SCANNED,
  percentage: 0,
  loaded: 0,
  total: 0,
};

/**
 * False on the first render, true once the browser has painted it (a frame,
 * then a task after it).
 *
 * The scan walks the whole project, and the inspector it answers for opens on
 * a click: walked in the first render, it was most of the long task the click
 * cost at 10,000 posts (`scenarios/measure/results.md`, "The Studio, built").
 * After the paint, the inspector is on screen first and the walk is its own
 * task, as the slices of a scan that waits for a load already are.
 */
function usePaintedOnce(): boolean {
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    if (painted) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timeout = setTimeout(() => setPainted(true), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [painted]);
  return painted;
}
