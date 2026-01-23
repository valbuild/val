import { Json, ModuleFilePath, SerializedSchema } from "@valbuild/core";

export type RouteInfo = {
  route: string;
  moduleFilePath: ModuleFilePath;
};

/**
 * Get all routes from router modules with their module paths
 *
 * Scans all modules to find those with routers (s.record().router())
 * and returns all route keys with their corresponding module paths
 */
export function getRoutesWithModulePaths(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Json>
): RouteInfo[] {
  const routeMap = new Map<string, ModuleFilePath>();

  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    const source = sources[moduleFilePath];

    // Check if this module is a router
    if (
      schema &&
      schema.type === "record" &&
      schema.router &&
      source &&
      typeof source === "object" &&
      !Array.isArray(source)
    ) {
      // Add all keys from this router module
      for (const key in source) {
        if (!routeMap.has(key)) {
          routeMap.set(key, moduleFilePath);
        }
      }
    }
  }

  // Convert to array and sort alphabetically
  const routes: RouteInfo[] = Array.from(routeMap.entries()).map(
    ([route, moduleFilePath]) => ({
      route,
      moduleFilePath,
    })
  );

  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Get all routes from router modules
 *
 * Scans all modules to find those with routers (s.record().router())
 * and returns all route keys from those modules
 */
export function getRoutesOf(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Json>
): string[] {
  return getRoutesWithModulePaths(schemas, sources).map((r) => r.route);
}
