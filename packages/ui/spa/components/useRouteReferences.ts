import { useDeferredValue, useMemo } from "react";
import {
  useAllSources,
  useSchemas,
  useLoadingStatus,
} from "./ValFieldProvider";
import {
  buildRouteReferenceIndex,
  getRouteReferences,
  RouteReferenceIndex,
} from "./getRouteReferences";
import {
  ReferencesResult,
  useReferenceScanStatus,
  withReferences,
} from "./useJsonValuesLoad";

/**
 * The `s.route()` fields whose value is `routeKey`.
 *
 * Returns a {@link ReferencesResult}, not a bare array: the scan is blind to
 * `.jsonValues()` entry content that is not loaded, so a caller that gates a
 * delete or a rename must wait for `status === "success"` before believing the
 * refs are complete.
 *
 * Route refs are the over-approximated case — `SerializedRouteSchema` records no
 * target module, so ANY jsonValues item schema containing a route field has to be
 * loaded before this can be trusted.
 */
export function useEagerRouteReferences(
  routeKey: string | undefined,
): ReferencesResult {
  const schemas = useSchemas();
  const loadingStatus = useLoadingStatus();
  const allSources = useAllSources();
  const query = useMemo(
    () => (routeKey === undefined ? null : ({ kind: "route" } as const)),
    [routeKey],
  );
  const scan = useReferenceScanStatus(query);

  const references = useMemo(() => {
    if (
      routeKey !== undefined &&
      "data" in schemas &&
      schemas.data !== undefined
    ) {
      return getRouteReferences(schemas.data, allSources, routeKey);
    }
    return [];
  }, [loadingStatus, allSources, schemas, routeKey]);

  // Memoised for the same reason as `useKeysOf`.
  return useMemo(() => withReferences(scan, references), [scan, references]);
}

/**
 * The whole route → referrers index, for a caller asking about many URLs.
 *
 * Lazy in the three ways that are available here, and the ones that are not
 * are worth naming:
 *
 * - **Lazy in time.** Nothing is built until a component calls this, so the
 *   index does not exist until the external pages dialog is opened, and it is
 *   thrown away when it closes. The Studio does not carry it around.
 * - **Lazy in re-renders.** The memo holds across every render that does not
 *   change the sources or the schemas, which on a dialog with a filter field
 *   in it is almost all of them.
 * - **Lazy in paint.** `useDeferredValue` lets the dialog render on the
 *   sources it already had while a changed set is re-indexed, so typing in a
 *   filter cannot stutter on a project with a lot of content. The design
 *   already distinguishes "no references" from "not counted yet", so a first
 *   paint with the previous index is a state the UI can show honestly.
 * - **NOT lazy per row.** The obvious reading — count a URL only when its row
 *   is looked at — costs more, not less: it is one traversal per URL instead
 *   of one for all of them, since reaching the leaves is the expense and
 *   comparing them is not. It would also break the two things the count is
 *   for: the `Unused` filter, which has to know about rows it is about to
 *   hide, and the counts in the toolbar.
 *
 * What stays genuinely incomplete is `.jsonValues()` entry content that has not
 * been fetched: this walks what is in the store, so callers still have to read
 * {@link useReferenceScanStatus} to know whether the answer can be trusted.
 * That is the one part of a scan that is slow for a reason no index can fix.
 */
export function useRouteReferenceIndex(enabled: boolean): {
  index: RouteReferenceIndex;
  scan: ReturnType<typeof useReferenceScanStatus>;
} {
  const schemas = useSchemas();
  const loadingStatus = useLoadingStatus();
  const allSources = useAllSources();
  const scan = useReferenceScanStatus(enabled ? { kind: "route" } : null);

  // Deferred, not the sources themselves: an index built from a stale source
  // set is coherent - every path in it existed - where a half-applied one
  // would not be.
  const inputs = useMemo(
    () => ({ schemas, allSources, loadingStatus, enabled }),
    [schemas, allSources, loadingStatus, enabled],
  );
  const deferred = useDeferredValue(inputs);

  return useMemo(() => {
    if (
      !deferred.enabled ||
      !("data" in deferred.schemas) ||
      deferred.schemas.data === undefined
    ) {
      return { index: EMPTY_INDEX, scan };
    }
    return {
      index: buildRouteReferenceIndex(
        deferred.schemas.data,
        deferred.allSources,
      ),
      scan,
    };
  }, [deferred, scan]);
}

/** Stable, so "not asked for" does not churn a caller's dependencies. */
const EMPTY_INDEX: RouteReferenceIndex = new Map();
