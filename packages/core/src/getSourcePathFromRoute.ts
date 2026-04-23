import type { ModuleFilePath, SourcePath } from "./val";
import type { SerializedSchema } from "./schema";
import { parseNextJsRoutePattern, validateUrlAgainstPattern } from "./router";

/**
 * Given a URL pathname (e.g. "/blogs/blog-1") and all serialized module schemas,
 * finds the matching next-app-router module and returns the module file path
 * and the source path for that route's content.
 *
 * External routers (e.g. external-url-router) are intentionally skipped.
 * Returns null if no next-app-router module matches the pathname.
 */
export function getSourcePathFromRoute(
  pathname: string,
  schemas: Record<ModuleFilePath, SerializedSchema>,
): {
  moduleFilePath: ModuleFilePath;
  sourcePath: SourcePath;
  route: string;
} | null {
  for (const [moduleFilePath, schema] of Object.entries(schemas) as [
    ModuleFilePath,
    SerializedSchema,
  ][]) {
    if (schema.type !== "record" || schema.router !== "next-app-router") {
      continue;
    }
    const routePattern = parseNextJsRoutePattern(moduleFilePath);
    const { isValid } = validateUrlAgainstPattern(pathname, routePattern);
    if (isValid) {
      const sourcePath =
        `${moduleFilePath}?p=${JSON.stringify(pathname)}` as SourcePath;
      return { moduleFilePath, sourcePath, route: pathname };
    }
  }
  return null;
}
