import { useMemo } from "react";
import {
  useAllSources,
  useSchemas,
  useLoadingStatus,
} from "./ValFieldProvider";
import { getRouteReferences } from "./getRouteReferences";
import {
  ReferencesResult,
  useReferenceScanStatus,
  withReferences,
} from "./useReferenceScanStatus";

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

  return withReferences(scan, references);
}
