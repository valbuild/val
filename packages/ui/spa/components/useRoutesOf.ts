import { useMemo } from "react";
import { useAllSources, useLoadingStatus, useSchemas } from "./ValProvider";
import { getRoutesOf } from "./getRoutesOf";

/**
 * Hook to get all available routes from router modules
 *
 * Returns an array of route strings from all modules that have routers defined
 */
export function useRoutesOf(): string[] {
  const schemas = useSchemas();
  const loadingStatus = useLoadingStatus();
  const allSources = useAllSources();

  const routes = useMemo(() => {
    if ("data" in schemas && schemas.data !== undefined) {
      return getRoutesOf(schemas.data, allSources);
    }
    return [];
  }, [loadingStatus, allSources, schemas]);

  return routes;
}
