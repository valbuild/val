import { SourcePath } from "@valbuild/core";
import { useCallback, useState } from "react";
import { useAllSources, useSchemas } from "./ValProvider";
import { getRouteReferences } from "./getRouteReferences";

/**
 * Hook to lazily get route references for a specific route key
 *
 * Returns a tuple of [references, loadReferences] where:
 * - references: the SourcePath[] of all s.route() fields pointing to this route key (initially empty)
 * - loadReferences: a function to trigger the expensive computation
 *
 * This is designed to be lazy since computing references can be expensive
 * (it scans all modules and sources).
 */
export function useRouteReferences(
  routeKey: string | undefined,
): [SourcePath[], () => void] {
  const schemas = useSchemas();
  const allSources = useAllSources();
  const [references, setReferences] = useState<SourcePath[]>([]);

  const loadReferences = useCallback(() => {
    if (
      routeKey !== undefined &&
      "data" in schemas &&
      schemas.data !== undefined
    ) {
      const refs = getRouteReferences(schemas.data, allSources, routeKey);
      setReferences(refs);
    }
  }, [routeKey, schemas, allSources]);

  return [references, loadReferences];
}
