import type { Json, SerializedSchema } from "@valbuild/core";
import { isPageModule } from "../utils/pageRoutes";

/**
 * The site's pages, for the design tab's page list: every key of every module
 * whose keys are this site's URLs (`isPageModule`), sorted, `/` first.
 *
 * The SITE's, read from the Studio the tab runs in: a page the proposal adds
 * is not here until it is published, and is reached by typing its path.
 */
export function sitePages(
  schemas: Record<string, SerializedSchema>,
  sources: Record<string, Json>,
): string[] {
  const pages = new Set<string>();
  for (const [path, schema] of Object.entries(schemas)) {
    if (!isPageModule(schema)) continue;
    const source = sources[path];
    if (typeof source !== "object" || source === null || Array.isArray(source))
      continue;
    for (const route of Object.keys(source)) {
      if (route.startsWith("/")) pages.add(route);
    }
  }
  return [...pages].sort((a, b) =>
    a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b),
  );
}
