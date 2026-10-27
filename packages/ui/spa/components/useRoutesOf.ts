import { useCallback, useSyncExternalStore } from "react";
import { useValSystem, type ValSystem } from "../stores/react/SystemContext";
import { getRoutesWithModulePaths, RouteInfo } from "./getRoutesOf";

/**
 * Every route the project declares, derived once per source version.
 *
 * ## Why this is not two `useMemo`s over `useAllSources()`
 *
 * It was, and both hooks below are rendered PER FIELD — `RouteField` for its
 * selector, and every `RichTextField` through `useRichTextEditorConfig` for its
 * link catalogue. `useAllSources()` is a whole-project subscription whose
 * snapshot is a version NUMBER, so it changes on every keystroke anywhere in the
 * Studio; each of those fields therefore re-rendered and re-walked the project's
 * routers on every character typed into any other field.
 *
 * Two things fix it, and both are needed:
 *
 * - the walk is shared and memoised on the source version, so N fields cost ONE
 *   walk per change rather than N;
 * - the answer is reference-stable by recompute-and-compare, so a change that
 *   does not move the routes — which is almost every change, since a route is a
 *   router record's KEY — hands back the same array and
 *   `useSyncExternalStore` bails out with no re-render at all.
 *
 * Compare rather than invalidate, for the reason the stores give everywhere
 * else: the list of things that can change a route is longer than it looks
 * (a key added, a module loaded, a schema replaced by HMR), and a list of call
 * sites has to stay complete forever and fails silently when it does not.
 *
 * The cache hangs off the SYSTEM rather than off a module-level variable, so two
 * systems in one process — which is every test file — cannot answer for each
 * other. A `WeakMap`, so a discarded system takes its entry with it.
 */
const routeCache = new WeakMap<
  object,
  { version: number; schemas: number; routes: RouteInfo[] }
>();

function sameRoutes(a: RouteInfo[], b: RouteInfo[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (
      a[index].route !== b[index].route ||
      a[index].moduleFilePath !== b[index].moduleFilePath
    ) {
      return false;
    }
  }
  return true;
}

const NO_ROUTES: RouteInfo[] = [];

function readRoutes(val: ValSystem | null): RouteInfo[] {
  if (val === null) {
    return NO_ROUTES;
  }
  const version = val.system.sourceStore.sourcesVersion();
  const schemas = val.system.schemaStore.all();
  // The schema map is replaced wholesale by intake, so its SIZE moves exactly
  // when it does — the same reasoning `useSchemasVersion` gives for counting
  // rather than versioning.
  const schemaCount = Object.keys(schemas).length;
  const cached = routeCache.get(val.system);
  if (
    cached !== undefined &&
    cached.version === version &&
    cached.schemas === schemaCount
  ) {
    return cached.routes;
  }
  const next = getRoutesWithModulePaths(
    schemas,
    val.system.sourceStore.allSources(),
  );
  // Recomputed, then compared: the identity only moves when the answer does.
  const routes =
    cached !== undefined && sameRoutes(cached.routes, next)
      ? cached.routes
      : next;
  routeCache.set(val.system, { version, schemas: schemaCount, routes });
  return routes;
}

function useRoutes(): RouteInfo[] {
  const val = useValSystem();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (val === null) return () => {};
      const offSource = val.system.sourceStore.events.on(
        "source:change",
        onChange,
      );
      const offSchema = val.system.schemaStore.events.on(
        "schema:init",
        onChange,
      );
      return () => {
        offSource();
        offSchema();
      };
    },
    [val],
  );
  const getSnapshot = useCallback(() => readRoutes(val), [val]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Every route the project's routers declare.
 *
 * Returns an array of route strings from all modules that have routers defined.
 */
export function useRoutesOf(): string[] {
  // Keyed on the identity of the shared array, so this is stable for exactly as
  // long as that one is — and shared between callers for the same reason.
  return routeStrings(useRoutes());
}

const stringsCache = new WeakMap<RouteInfo[], string[]>();

function routeStrings(routes: RouteInfo[]): string[] {
  const cached = stringsCache.get(routes);
  if (cached !== undefined) {
    return cached;
  }
  const strings = routes.map((info) => info.route);
  stringsCache.set(routes, strings);
  return strings;
}

/**
 * Every route with the module it lives in.
 *
 * Returns an array of RouteInfo objects containing both the route and its module
 * path.
 */
export function useRoutesWithModulePaths(): RouteInfo[] {
  return useRoutes();
}
