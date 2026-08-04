import { SourcePath } from "@valbuild/core";
import { useEffect, useMemo, useRef } from "react";
import {
  useAllSources,
  useJsonEntriesProgress,
  useSchemas,
  useSyncEngine,
} from "./ValFieldProvider";
import {
  JsonValuesLoadQuery,
  jsonValuesLoadRequirements,
} from "./jsonValuesLoadRequirements";

/**
 * A reference scan's result. `status` is the part that matters for a destructive
 * action: `refs` is only guaranteed COMPLETE when the status is `success`.
 *
 * A scan walks the client's source tree, and a `.jsonValues()` entry whose
 * content has not been loaded is an opaque marker — invisible to the scan. So
 * while `loading`, "no refs found" means nothing, and on `error` it never
 * becomes trustworthy: only a retry can. Anything that deletes or renames on the
 * strength of a scan must therefore gate on `status === "success"`, not on
 * `refs.length`.
 *
 * `refs` is still populated in the non-success states (what has been found so
 * far), because a ref that IS found is real, and showing it early is better than
 * hiding it.
 */
export type ReferencesResult =
  | { status: "loading"; refs: SourcePath[]; percentage: number }
  | { status: "success"; refs: SourcePath[] }
  | { status: "error"; refs: SourcePath[]; message: string; retry: () => void };

/** {@link ReferencesResult} before the refs are known — the loading half alone. */
export type ReferenceScanStatus =
  | { status: "loading"; percentage: number }
  | { status: "success" }
  | { status: "error"; message: string; retry: () => void };

const SCAN_COMPLETE: ReferenceScanStatus = { status: "success" };

/**
 * Loads whatever `.jsonValues()` entry content a reference scan for `query`
 * needs before its answer can be trusted, and reports how that is going.
 *
 * The predicate decides scope from the SCHEMAS alone
 * ({@link jsonValuesLoadRequirements}), and in the common case it names no
 * modules at all: this hook then returns `success` on the first render, having
 * issued no requests. Only a jsonValues item schema that points OUTWARD at what
 * is being edited (a `keyOf`/file ref to the same module, or — over-approximated
 * — any `route` field) forces a load.
 *
 * Pass `null` for `query` when there is nothing to scan for; the hook then does
 * nothing and reports `success`, which keeps the callers' "no parent record" /
 * "not a router item" cases free.
 */
export function useReferenceScanStatus(
  query: JsonValuesLoadQuery | null,
): ReferenceScanStatus {
  const syncEngine = useSyncEngine();
  const schemas = useSchemas();
  const progress = useJsonEntriesProgress();
  // Subscribing to sources is what re-renders this hook as batches land: every
  // load pass ends in an invalidateSource, which emits "all-sources".
  useAllSources();

  const required = useMemo(() => {
    if (query === null || schemas.status !== "success") {
      return null;
    }
    return jsonValuesLoadRequirements(schemas.data, query);
  }, [
    query,
    schemas.status,
    schemas.status === "success" ? schemas.data : null,
  ]);
  // The module list as a primitive, so effects key on its CONTENT: `useSchemas`
  // rebuilds its record every render, so `required` is a fresh array every render
  // even when nothing changed.
  const requiredKey = required === null ? null : required.join("\n");
  const requiredRef = useRef(required);
  requiredRef.current = required;

  const loadStatus =
    required === null || required.length === 0
      ? null
      : syncEngine.getJsonEntriesLoadStatus(required);
  const needsLoad = loadStatus?.status === "incomplete";

  useEffect(() => {
    const moduleFilePaths = requiredRef.current;
    if (!needsLoad || moduleFilePaths === null) {
      return;
    }
    void syncEngine.ensureJsonEntries(moduleFilePaths);
  }, [syncEngine, requiredKey, needsLoad]);

  if (query === null) {
    return SCAN_COMPLETE;
  }
  if (schemas.status === "loading") {
    return { status: "loading", percentage: 0 };
  }
  if (schemas.status === "error") {
    return {
      status: "error",
      message: schemas.error,
      retry: () => {
        // Schemas are owned by the sync engine's init/sync loop; there is nothing
        // for this hook to retry.
      },
    };
  }
  if (loadStatus === null || loadStatus.status === "complete") {
    return SCAN_COMPLETE;
  }
  if (loadStatus.status === "error") {
    const { errors } = loadStatus;
    const first = errors[0];
    return {
      status: "error",
      message:
        errors.length === 1
          ? `Could not load ${first.key} in ${first.moduleFilePath}: ${first.message}`
          : `Could not load ${errors.length} entries. First failure — ${first.key} in ${first.moduleFilePath}: ${first.message}`,
      retry: () => {
        const moduleFilePaths = requiredRef.current;
        if (moduleFilePaths !== null) {
          void syncEngine.retryJsonEntries(moduleFilePaths);
        }
      },
    };
  }
  return {
    status: "loading",
    // The run has not started yet on the render that discovers the work, and an
    // idle progress store reports 100 — which would read as "done".
    percentage: progress.status === "loading" ? progress.percentage : 0,
  };
}

/** Attaches the refs a scan found to the status of the load it depended on. */
export function withReferences(
  scan: ReferenceScanStatus,
  refs: SourcePath[],
): ReferencesResult {
  if (scan.status === "success") {
    return { status: "success", refs };
  }
  if (scan.status === "loading") {
    return { status: "loading", refs, percentage: scan.percentage };
  }
  return {
    status: "error",
    refs,
    message: scan.message,
    retry: scan.retry,
  };
}

/**
 * Merges two scans of the same thing (e.g. `keyOf` refs and route refs to one
 * record key) into the one answer a destructive action can act on.
 *
 * The status is the WORST of the two — one incomplete scan makes the union
 * incomplete, whatever the other found — while the refs are the union, since a
 * ref either scan found is real.
 */
export function mergeReferences(
  a: ReferencesResult,
  b: ReferencesResult,
): ReferencesResult {
  const refs = a.refs.concat(b.refs.filter((ref) => !a.refs.includes(ref)));
  if (a.status === "error") {
    return { ...a, refs };
  }
  if (b.status === "error") {
    return { ...b, refs };
  }
  if (a.status === "loading" || b.status === "loading") {
    const percentages: number[] = [];
    if (a.status === "loading") {
      percentages.push(a.percentage);
    }
    if (b.status === "loading") {
      percentages.push(b.percentage);
    }
    return { status: "loading", refs, percentage: Math.min(...percentages) };
  }
  return { status: "success", refs };
}
