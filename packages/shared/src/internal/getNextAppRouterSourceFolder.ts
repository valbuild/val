import { ModuleFilePath } from "@valbuild/core";

export function getNextAppRouterSourceFolder(moduleFilePath: ModuleFilePath) {
  if (moduleFilePath.startsWith("/app")) {
    return "/app";
  } else if (moduleFilePath.startsWith("/src/app")) {
    return "/src/app";
  }
  return null;
}

/**
 * The folder a TanStack Router app keeps its route files in.
 *
 * The same question as above for the other convention: `routes/` at the project
 * root, or under `src/`. A Val module for a route lives beside the route file
 * and is named the same way, so this is the prefix to strip before reading the
 * route pattern out of the rest.
 */
export function getTanStackRouterSourceFolder(moduleFilePath: ModuleFilePath) {
  if (moduleFilePath.startsWith("/routes/")) {
    return "/routes";
  } else if (moduleFilePath.startsWith("/src/routes/")) {
    return "/src/routes";
  }
  return null;
}

/**
 * The route folder of whichever page router this module belongs to.
 *
 * The two conventions have disjoint prefixes — `app/` versus `routes/` — so a
 * module file path answers this on its own, which is what the Studio needs: it
 * walks every schema in the project and has no framework to ask.
 */
export function getPageRouterSourceFolder(moduleFilePath: ModuleFilePath) {
  return (
    getNextAppRouterSourceFolder(moduleFilePath) ??
    getTanStackRouterSourceFolder(moduleFilePath)
  );
}

/**
 * Whether a route folder is a TanStack Router one.
 *
 * Exported so the pattern derivation and the source-folder detection cannot
 * drift apart about what `/src/routes` means.
 */
export function isTanStackRoutesFolder(srcFolder: string): boolean {
  return srcFolder === "/routes" || srcFolder === "/src/routes";
}
