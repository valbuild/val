import type { ModuleFilePath, SourcePath } from "./val";
import type { SerializedSchema } from "./schema";
import {
  parseNextJsRoutePattern,
  parseTanStackRoutePattern,
  validateUrlAgainstPattern,
} from "./router";

/**
 * The routers whose keys are URL paths of THIS site, and how to read the route
 * pattern a module of each serves.
 *
 * Keyed by router id because that is all a serialized schema carries. A router
 * that is not in here — `external-url-router` today — has keys that are URLs of
 * somewhere else, so matching this site's pathname against them is meaningless
 * rather than merely unsupported.
 */
const PAGE_ROUTE_PATTERN_PARSERS: Record<
  string,
  (moduleFilePath: ModuleFilePath) => string[]
> = {
  "next-app-router": parseNextJsRoutePattern,
  "tanstack-router": parseTanStackRoutePattern,
};

/**
 * Given a URL pathname (e.g. "/blogs/blog-1") and all serialized module schemas,
 * finds the page-router module that serves that route and returns the module
 * file path and the source path for that route's content.
 *
 * External routers (e.g. external-url-router) are intentionally skipped.
 * Returns null if no page-router module matches the pathname.
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
    if (schema.type !== "record" || !schema.router) {
      continue;
    }
    const parseRoutePattern = PAGE_ROUTE_PATTERN_PARSERS[schema.router];
    if (!parseRoutePattern) {
      continue;
    }
    const routePattern = parseRoutePattern(moduleFilePath);
    const { isValid } = validateUrlAgainstPattern(pathname, routePattern);
    if (isValid) {
      const sourcePath =
        `${moduleFilePath}?p=${JSON.stringify(pathname)}` as SourcePath;
      return { moduleFilePath, sourcePath, route: pathname };
    }
  }
  return null;
}

/**
 * Whether a router id is one whose keys are routes of this site.
 *
 * The same question `getSourcePathFromRoute` asks, exported because the Studio
 * asks it too — a page router gets the sitemap and the "Pages" menu, an
 * external one gets a flat list of URLs — and the two must not disagree about
 * which is which.
 */
export function isPageRouter(routerId: string): boolean {
  return routerId in PAGE_ROUTE_PATTERN_PARSERS;
}
