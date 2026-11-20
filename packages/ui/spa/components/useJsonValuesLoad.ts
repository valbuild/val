import { useValSystem } from "../stores/react/SystemContext";
import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useEffect, useMemo, useRef } from "react";
import { useAllSources, useSchemas } from "./ValFieldProvider";
import {
  JsonValuesLoadQuery,
  allJsonValuesModules,
  jsonValuesLoadRequirements,
} from "./jsonValuesLoadRequirements";

/**
 * How a consumer that needs `.jsonValues()` entry CONTENT is doing: `success`
 * means everything it needs is loaded and fresh, `loading` that it is on its way,
 * and `error` that it cannot be trusted until a retry succeeds.
 */
export type JsonValuesLoadStatus =
  | {
      status: "loading";
      percentage: number;
      /**
       * Entries of the modules being loaded that are here, and how many they
       * have: what a progress bar says ("2,300 of 10,000"). Both 0 while the
       * set of modules is not known yet.
       */
      loaded: number;
      total: number;
    }
  | { status: "success" }
  | {
      status: "error";
      message: string;
      /**
       * Absent when there is nothing the UI could retry (the schemas themselves
       * failed — the sync engine owns that). A dead "Try again" button is worse
       * than none.
       */
      retry?: () => void;
    };

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
  | {
      status: "loading";
      refs: SourcePath[];
      percentage: number;
      loaded: number;
      total: number;
    }
  | { status: "success"; refs: SourcePath[] }
  | {
      status: "error";
      refs: SourcePath[];
      message: string;
      retry?: () => void;
    };

const LOAD_COMPLETE: JsonValuesLoadStatus = { status: "success" };
/** Stable empty list, so "nothing to load" does not churn the memo deps. */
const NOTHING_TO_LOAD: ModuleFilePath[] = [];

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
): JsonValuesLoadStatus {
  const schemas = useSchemas();
  const required = useMemo(() => {
    if (query === null) {
      return NOTHING_TO_LOAD;
    }
    if (schemas.status !== "success") {
      // Scope is unknown until the schemas are in: neither "nothing to load" nor
      // a module list would be true yet.
      return null;
    }
    return jsonValuesLoadRequirements(schemas.data, query);
  }, [
    query,
    schemas.status,
    schemas.status === "success" ? schemas.data : null,
  ]);
  const load = useJsonValuesLoad(required);
  // Memoised for the same reason as the tail of `useJsonValuesLoad`: this is a
  // dependency downstream, so the schema-error branch must not mint a new object
  // per render either.
  return useMemo<JsonValuesLoadStatus>(() => {
    if (query !== null && schemas.status === "error") {
      return { status: "error", message: schemas.error };
    }
    return load;
  }, [
    query,
    schemas.status,
    schemas.status === "error" ? schemas.error : null,
    load,
  ]);
}

/**
 * Loads the content of EVERY `.jsonValues()` entry in the project, for the one
 * consumer that cannot be scoped: search indexes all content by definition.
 *
 * `enabled` is what keeps that honest — pass it on user INTENT (a non-empty
 * query), not on mount, so opening the search dialog still costs nothing.
 */
export function useAllJsonValuesLoad(enabled: boolean): JsonValuesLoadStatus {
  const schemas = useSchemas();
  const required = useMemo(() => {
    if (!enabled) {
      return NOTHING_TO_LOAD;
    }
    if (schemas.status !== "success") {
      return null;
    }
    return allJsonValuesModules(schemas.data);
  }, [
    enabled,
    schemas.status,
    schemas.status === "success" ? schemas.data : null,
  ]);
  return useJsonValuesLoad(required);
}

/**
 * The shared machinery: loads `moduleFilePaths`' entries and reports progress.
 *
 * `null` means the set is not known yet (schemas still loading) and reports
 * `loading`; an empty list means nothing needs loading and reports `success`
 * without touching the network.
 *
 * Completeness is read from the ENGINE on every render rather than held in state
 * here: a held answer goes stale the moment a publish invalidates an entry, and a
 * consumer acting on a stale "complete" is the class of bug this exists to
 * prevent.
 */
function useJsonValuesLoad(
  moduleFilePaths: ModuleFilePath[] | null,
): JsonValuesLoadStatus {
  const val = useValSystem();
  // Subscribing to sources is what re-renders this hook as batches land: a
  // batch arriving bumps its module, which is a `source:change`.
  useAllSources();

  // The module list as a primitive, so effects key on its CONTENT: the schema
  // record is rebuilt every render, so `moduleFilePaths` is a fresh array every
  // render even when nothing changed.
  const requiredKey =
    moduleFilePaths === null ? null : moduleFilePaths.join("\n");
  const requiredRef = useRef(moduleFilePaths);
  requiredRef.current = moduleFilePaths;

  const loadStatus =
    moduleFilePaths === null || moduleFilePaths.length === 0
      ? null
      : (val?.system.sourceStore.entriesStatus(moduleFilePaths) ?? null);
  /**
   * Loading until complete, failures included: a load of 10,000 entries with
   * one failed batch keeps going (and says so) rather than stopping where the
   * first failure was found, which is what dropping the load on `error` did.
   */
  const needsLoad = loadStatus !== null && loadStatus.status !== "complete";

  // Of the modules asked for, not the project: a "used by" waits for the
  // records that can point at the file, and says how far those are.
  let loaded = 0;
  let total = 0;
  if (needsLoad && moduleFilePaths !== null && val !== null) {
    for (const moduleFilePath of moduleFilePaths) {
      const progress = val.system.sourceStore.entriesProgress(moduleFilePath);
      loaded += progress.loaded;
      total += progress.total;
    }
  }

  useEffect(() => {
    const modules = requiredRef.current;
    if (!needsLoad || modules === null || val === null) {
      return;
    }
    // Nobody waiting any more (search closed, the inspector left): the store
    // drops the batches it has not sent. See `SourceStore.loadAllEntries`.
    const stop = new AbortController();
    for (const moduleFilePath of modules) {
      void val.system.sourceStore.loadAllEntries(moduleFilePath, {
        signal: stop.signal,
      });
    }
    return () => stop.abort();
  }, [val, requiredKey, needsLoad]);

  /**
   * Memoised, because this result is a DEPENDENCY, not just a value to render.
   *
   * `useKeysOf` and `useEagerRouteReferences` pass it through `withReferences`
   * into components that put it in effect dependencies, so a fresh object per
   * render is a render loop. That is what killed the `.jsonValues()` record
   * route: `ArrayAndRecordTools` saw a new `refs` on all 118 of its renders and
   * the page ended on "Maximum update depth exceeded".
   *
   * Every input here is stable by contract — `entriesStatus` is
   * reference-stable in `SourceStore`, the counts are numbers and
   * `requiredKey` is a string — so this memo genuinely holds rather than
   * recomputing each time.
   */
  return useMemo<JsonValuesLoadStatus>(() => {
    if (moduleFilePaths === null) {
      return { status: "loading", percentage: 0, loaded: 0, total: 0 };
    }
    if (loadStatus === null || loadStatus.status === "complete") {
      return LOAD_COMPLETE;
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
        // Guarded on the requirements still being there: `errors` is a snapshot
        // from this render, and a retry fired after the caller stopped needing
        // these modules would re-fetch entries nobody is waiting for.
        retry: () => {
          if (requiredRef.current === null) {
            return;
          }
          const byModule = new Map<ModuleFilePath, string[]>();
          for (const { moduleFilePath, key } of errors) {
            const keys = byModule.get(moduleFilePath) ?? [];
            keys.push(key);
            byModule.set(moduleFilePath, keys);
          }
          for (const [moduleFilePath, keys] of byModule) {
            void val?.system.sourceStore.retryEntries(moduleFilePath, keys);
          }
        },
      };
    }
    return {
      status: "loading",
      percentage: total === 0 ? 0 : Math.floor((loaded / total) * 100),
      loaded,
      total,
    };
    // `moduleFilePaths` is deliberately absent: it is a fresh array every render
    // (the schema record is rebuilt), and `requiredKey` is its content as a
    // string, which is what this actually depends on.
  }, [val, requiredKey, moduleFilePaths === null, loadStatus, loaded, total]);
}

/** Attaches the refs a scan found to the status of the load it depended on. */
export function withReferences(
  scan: JsonValuesLoadStatus,
  refs: SourcePath[],
): ReferencesResult {
  if (scan.status === "success") {
    return { status: "success", refs };
  }
  if (scan.status === "loading") {
    return {
      status: "loading",
      refs,
      percentage: scan.percentage,
      loaded: scan.loaded,
      total: scan.total,
    };
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
    // The one further behind: the union is only as far as its slower half.
    const behind =
      a.status === "loading" &&
      (b.status !== "loading" || a.percentage <= b.percentage)
        ? a
        : b;
    if (behind.status === "loading") {
      return {
        status: "loading",
        refs,
        percentage: behind.percentage,
        loaded: behind.loaded,
        total: behind.total,
      };
    }
  }
  return { status: "success", refs };
}
