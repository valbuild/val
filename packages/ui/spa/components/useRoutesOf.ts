import { useMemo } from "react";
import {
  useAllSources,
  useSchemas,
  useLoadingStatus,
} from "./ValFieldProvider";
import {
  getRoutesOf,
  getRoutesWithModulePaths,
  RouteInfo,
} from "./getRoutesOf";

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

/**
 * Hook to get all available routes with their module paths from router modules
 *
 * Returns an array of RouteInfo objects containing both the route and its module path
 */
export function useRoutesWithModulePaths(): RouteInfo[] {
  const schemas = useSchemas();
  const loadingStatus = useLoadingStatus();
  const allSources = useAllSources();

  const routes = useMemo(() => {
    if ("data" in schemas && schemas.data !== undefined) {
      return getRoutesWithModulePaths(schemas.data, allSources);
    }
    return [];
  }, [loadingStatus, allSources, schemas]);

  return routes;
}
