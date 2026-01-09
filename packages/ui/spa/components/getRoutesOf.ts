import { Json, ModuleFilePath, SerializedSchema } from "@valbuild/core";

/**
 * Get all routes from router modules
 *
 * Scans all modules to find those with routers (s.record().router())
 * and returns all route keys from those modules
 */
export function getRoutesOf(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Json>,
): string[] {
  const routes: string[] = [];

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
        if (!routes.includes(key)) {
          routes.push(key);
        }
      }
    }
  }

  return routes.sort(); // Sort alphabetically for better UX
}
