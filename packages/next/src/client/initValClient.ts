import {
  Internal,
  type ResolvableModule,
  SelectorSource,
  SourceObject,
  type ValModule,
} from "@valbuild/core";
import {
  type JsonEntryContentOf,
  type ReadEnv,
  type Resolution,
  type Resolvable,
  type ResolvedVal,
  type RouteValueOf,
  type ValExternalStore,
  isJsonValuesRecordSchema,
  mapResolution,
  overlaySource,
  resolveModuleEntry,
  resolveVal,
  useResolved,
  useResolvedEntry,
  useResolvedVal,
} from "@valbuild/react/stega";
import React from "react";
import { ValConfig } from "@valbuild/core";
import { useValOverlayContext } from "../ValOverlayContext";
import { getValRouteUrlFromVal, initValRouteFromVal } from "../routeFromVal";

/** What the provider tells the hooks: `ValOverlayContext`'s value. */
export type PageReadState = {
  store?: ValExternalStore;
  draftMode: boolean | null;
  suspend: boolean;
  draftModeReady?: Promise<void>;
  draftSourcesSynced?: boolean;
};

/**
 * Where this page's hooks read from, in order: what the Studio sent (the
 * overlay), then -- added by every read -- the bundle. Edit tags in draft
 * mode. A plain function of the provider's state, as `@valbuild/tanstack`'s
 * is (which the scenario world reads a page with).
 */
export function pageReadEnv(state: PageReadState): ReadEnv {
  return {
    sources: [
      overlaySource(state.store, {
        draftMode: state.draftMode,
        suspend: state.suspend,
        draftModeReady: state.draftModeReady,
        synced: state.draftSourcesSynced ?? false,
      }),
    ],
    encode: !!state.draftMode,
  };
}

/**
 * {@link pageReadEnv} for this component, kept while nothing it is made of
 * moves, so a component's subscription is not made again on every render.
 */
function useReadEnv(): ReadEnv {
  const { store, draftMode, suspend, draftModeReady, draftSourcesSynced } =
    useValOverlayContext();
  return React.useMemo(
    () =>
      pageReadEnv({
        store,
        draftMode,
        suspend,
        draftModeReady,
        draftSourcesSynced,
      }),
    [store, draftMode, suspend, draftModeReady, draftSourcesSynced],
  );
}

/** What `useVal` gives back — see `ResolvedVal` in `@valbuild/react/stega`. */
export type UseValType<T extends SelectorSource> = ResolvedVal<T>;

function useValStega<T extends Resolvable>(selector: T): UseValType<T> {
  return useResolvedVal(selector, useReadEnv());
}

/**
 * Client counterpart to `fetchValKey`: resolves a SINGLE `.jsonValues()` entry
 * by key, loading only that entry's backing `*.val.json` (one dynamic import).
 * Suspends (via `React.use`) until the entry loads, so it must be rendered
 * inside a `<Suspense>` boundary.
 *
 * In draft mode it renders the editor's unpublished content, taken from the
 * overlay; an entry the draft deleted is `undefined`, never the bundled one.
 */
function useValKeyStega<T extends ResolvableModule>(
  selector: T,
  key: string,
): JsonEntryContentOf<T> | undefined {
  return useResolvedEntry(selector, key, useReadEnv());
}

function resolveParams(
  params:
    | Record<string, string | string[]>
    | Promise<Record<string, string | string[]>>,
) {
  if (!params) {
    return null;
  }
  if ("then" in params) {
    // Defensive guard: peerDependencies declare React >=19, but if a consumer
    // somehow ends up on React 18 with a promise params arg, surface a
    // diagnosable error instead of a cryptic `TypeError: React.use is not a
    // function`. Callers treat null as the error sentinel.
    if (!("use" in React)) {
      Internal.log.error(
        "useValRoute received a Promise params argument but React.use is unavailable. Upgrade to React 19+ or pre-resolve the promise before passing it.",
      );
      return null;
    }
    return React.use(params as Promise<Record<string, string | string[]>>);
  }
  return params;
}

/**
 * `useValRoute`'s read, once its params are known: a `.jsonValues()`
 * router's one entry for the params (one dynamic import, like `useValKey`),
 * or the router's entry for them. `null` for no such route.
 */
function routeRead<T extends ResolvableModule>(
  selector: T,
  params: Record<string, string | string[]>,
  env: ReadEnv,
  settled?: ReadonlySet<Promise<void>>,
): Resolution<RouteValueOf<T> | null> {
  // A view is a pointer: everything below reads a path, a schema and a source
  // off this, and a pointer has none of them. See `resolveViewedModule`.
  return moduleRouteRead<RouteValueOf<T>>(
    Internal.resolveViewedModule<SourceObject>(selector),
    params,
    env,
    settled,
  );
}

/**
 * {@link routeRead}, for a module (a view resolved). A plain function, so the
 * scenario world (`scenarios/`) reads a route as the hook does.
 */
export function moduleRouteRead<V>(
  valModule: ValModule<SelectorSource>,
  params: Record<string, string | string[]>,
  env: ReadEnv,
  settled?: ReadonlySet<Promise<void>>,
): Resolution<V | null> {
  const path = Internal.getValPath(valModule);
  const schema = Internal.getSchema(valModule);
  if (isJsonValuesRecordSchema(schema)) {
    const url = getValRouteUrlFromVal(
      params,
      "useValRoute",
      path,
      schema,
      Internal.getSource(valModule),
    );
    if (!url) {
      return { status: "ready", value: null, reads: [] };
    }
    return mapResolution(
      resolveModuleEntry<V>(valModule, url, env, { settled }),
      (entry) => (entry === undefined ? null : entry),
    );
  }
  return mapResolution(
    resolveVal(valModule, env, { settled }),
    (val): V | null =>
      initValRouteFromVal(params, "useValRoute", path, schema, val),
  );
}

function useValRouteStega<T extends ResolvableModule>(
  selector: T,
  params:
    | Record<string, string | string[]>
    | Promise<Record<string, string | string[]>>,
): RouteValueOf<T> {
  const env = useReadEnv();
  const resolvedParams = resolveParams(params);
  const value = useResolved<RouteValueOf<T> | null>(selector, env, (settled) =>
    resolvedParams === null
      ? NO_ROUTE
      : routeRead(selector, resolvedParams || {}, env, settled),
  );
  // Careful: null means there was an error - undefined means no params
  return (resolvedParams === null ? null : value) as RouteValueOf<T>;
}

const NO_ROUTE: Resolution<null> = { status: "ready", value: null, reads: [] };

function useValRouteUrl<T extends ResolvableModule>(
  selector: T,
  params?:
    | Record<string, string | string[]>
    | Promise<Record<string, string | string[]>>,
): string | null {
  // A view is a pointer: everything below reads a path, a schema and a source
  // off this, and a pointer has none of them. See `resolveViewedModule`.
  const valModule = Internal.resolveViewedModule<SourceObject>(selector);
  // The url is made of the params and the module's path: a `.jsonValues()`
  // router's entries are not imported for it.
  const val = useResolvedVal(valModule, useReadEnv(), { entries: false });
  const resolvedParams =
    params === undefined ? undefined : resolveParams(params);
  // Careful: null means there was an error - undefined means no params
  if (resolvedParams === null) {
    return null;
  }
  return getValRouteUrlFromVal(
    resolvedParams || {},
    "useValRouteUrl",
    valModule && Internal.getValPath(valModule),
    valModule && Internal.getSchema(valModule),
    val,
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initValClient(config: ValConfig): {
  useValStega: typeof useValStega;
  useValKeyStega: typeof useValKeyStega;
  useValRouteStega: typeof useValRouteStega;
  useValRouteUrl: typeof useValRouteUrl;
} {
  return {
    useValStega,
    useValKeyStega,
    useValRouteStega,
    useValRouteUrl,
  };
}
