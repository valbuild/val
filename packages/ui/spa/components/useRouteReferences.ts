import { SourcePath } from "@valbuild/core";
import { useMemo } from "react";
import {
  useAllSources,
  useSchemas,
  useLoadingStatus,
} from "./ValFieldProvider";
import { getRouteReferences } from "./getRouteReferences";

/**
 * Hook to get route references for a specific route key
 *
 * Returns an array of SourcePaths for all s.route() fields pointing to this route key.
 */
export function useEagerRouteReferences(
  routeKey: string | undefined,
): SourcePath[] {
  const schemas = useSchemas();
  const loadingStatus = useLoadingStatus();
  const allSources = useAllSources();

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

  return references;
}
