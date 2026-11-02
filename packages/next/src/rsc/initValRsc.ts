import {
  type JsonEntryContentOf,
  type Ready,
  type ReadEnv,
  type Resolvable,
  type ResolvedVal,
  type RouteValueOf,
  SET_AUTO_TAG_JSX_ENABLED,
  SET_RSC,
  awaitResolved,
  fetchValFrom,
  isJsonValuesRecordSchema,
  resolveVal,
  resolveValEntry,
} from "@valbuild/react/stega";
import {
  ValConfig,
  ValModules,
  Internal,
  type ResolvableModule,
  SourceObject,
} from "@valbuild/core";
import { cookies, draftMode, headers } from "next/headers";
import { cache } from "react";
import {
  type ContentSource,
  type RequestScopedMemo,
} from "@valbuild/shared/internal";
import {
  createValServer,
  draftForRequest,
  readerSchemaVersion,
  type DraftSources,
  type DraftValServer,
  type GetDraftSourcesScope,
  type ValServer,
} from "@valbuild/server";
import { VERSION } from "../version";
import { getValRouteUrlFromVal, initValRouteFromVal } from "../routeFromVal";

SET_RSC(true);

/*
 * The readers below are `resolveVal` (`@valbuild/react/stega`) over this
 * request's sources: the draft (`serverDraftSource`, in `@valbuild/server`),
 * then the bundle. Only the sources are Next's; the rule that picks between
 * them is the same in `@valbuild/tanstack` and in the hooks. See
 * `docs/plans/one-content-model.md`, "One way to load".
 */

export type { DraftSources, GetDraftSourcesScope };

/** What the draft readers read. */
export type DraftSourcesValServer = DraftValServer;

/** What the route readers need: what `fetchVal` does, the single-entry route among it. */
export type RouteReaderValServer = DraftSourcesValServer;

/**
 * The slice of `ValServer` the single-entry readers use. Narrower than
 * `ValServer` on purpose: it says what the dependency IS, and it lets a test
 * drive these readers with a one-route fake.
 */
export type JsonEntryValServer = Pick<ValServer, "/json">;

/**
 * A per-request memo box, from React's request memoisation.
 *
 * `cache()` is what makes this safe: in an RSC render React hands back the SAME
 * object for the length of one request and a fresh one for the next. Outside
 * that — a route handler, a test, the non-`react-server` build of React —
 * `cache` is a pass-through, so every call gets its own object, the memo misses,
 * and the reader does exactly what it did before. Ineffective, never shared.
 * See `memoizePerRequest`. `fetchVal` is an RSC API (`SET_RSC(true)` above, and
 * its own error messages say so), so the effective case is the normal one.
 *
 * Built PER `initValRsc` rather than once for the module, because the box is
 * only as specific as the `cache()` it came from: two Val servers in one
 * process sharing one would answer each other's reads within a request, and
 * they hold different content.
 */
export function createReactCacheScope(): GetDraftSourcesScope {
  const getBox = cache((): RequestScopedMemo<DraftSources | null> => ({}));
  return async () => getBox();
}

/** What a misuse of a reader is told, beside what went wrong. */
const WHERE = "fetchVal can only be used server-side. Use useVal on clients.";

/**
 * What a read in this request reads, in order: the draft (in draft mode),
 * then -- added by every read -- the bundle. Edit tags are decided here,
 * once, from draft mode.
 */
function requestEnv(enabled: boolean, draft: ContentSource | null): ReadEnv {
  if (enabled) {
    SET_AUTO_TAG_JSX_ENABLED(true);
  }
  return {
    sources: draft === null ? [] : [draft],
    encode: enabled,
    schemaVersionOf: readerSchemaVersion,
  };
}

/** What a reader needs from the app and the request. */
type ReaderDeps = {
  valServer: Promise<DraftValServer>;
  isEnabled: () => Promise<boolean>;
  getHeaders: () => Promise<{ get(name: string): string | null }>;
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>;
  scope: GetDraftSourcesScope;
};

/** `fetchVal`, with what it read: see `readsOfFetchVal`. */
function fetchValWithReads(deps: ReaderDeps) {
  return async <T extends Resolvable>(
    selector: T,
    opts?: { entries?: boolean },
  ): Promise<Ready<ResolvedVal<T>>> => {
    const { enabled, draft } = await draftForRequest({
      valServer: deps.valServer,
      isEnabled: deps.isEnabled,
      getCookies: deps.getCookies,
      modules: {
        valServer: deps.valServer,
        getHeaders: deps.getHeaders,
        scope: deps.scope,
      },
      where: WHERE,
    });
    const env = requestEnv(enabled, draft);
    return awaitResolved((settled) =>
      resolveVal(selector, env, { settled, ...opts }),
    );
  };
}

export const initFetchValStega = (
  config: ValConfig,
  valApiEndpoints: string,
  valServerPromise: Promise<DraftSourcesValServer>,
  isEnabled: () => Promise<boolean>,
  getHeaders: () => Promise<{
    get(name: string): string | null;
  }>,
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>,
  getDraftSourcesScope: GetDraftSourcesScope,
) =>
  fetchValFrom(
    fetchValWithReads({
      valServer: valServerPromise,
      isEnabled,
      getHeaders,
      getCookies,
      scope: getDraftSourcesScope,
    }),
  );

const initFetchValRouteStega = (
  config: ValConfig,
  valApiEndpoints: string,
  valServerPromise: Promise<RouteReaderValServer>,
  isEnabled: () => Promise<boolean>,
  getHeaders: () => Promise<{
    get(name: string): string | null;
  }>,
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>,
  getDraftSourcesScope: GetDraftSourcesScope,
) => {
  const fetchVal = fetchValWithReads({
    valServer: valServerPromise,
    isEnabled,
    getHeaders,
    getCookies,
    scope: getDraftSourcesScope,
  });
  const fetchValKey = initFetchValKeyStega(
    valServerPromise,
    isEnabled,
    getCookies,
  );
  return async <T extends ResolvableModule>(
    selector: T,
    params:
      | Promise<Record<string, string | string[]>>
      | Record<string, string | string[]>
      | unknown,
  ): Promise<RouteValueOf<T>> => {
    const resolvedParams = await Promise.resolve(params);
    // A view is a pointer: everything below reads a path, a schema and a source
    // off this, and a pointer has none of them. See `resolveViewedModule`.
    const valModule = Internal.resolveViewedModule<SourceObject>(selector);
    const path = valModule && Internal.getValPath(valModule);
    const schema = valModule && Internal.getSchema(valModule);
    // `.jsonValues()` router: map params → the entry key and load ONLY that
    // entry, instead of the whole record.
    if (isJsonValuesRecordSchema(schema)) {
      const url = getValRouteUrlFromVal(
        resolvedParams,
        "fetchValRoute",
        path,
        schema,
        valModule && Internal.getSource(valModule),
      );
      if (!url) {
        return null as RouteValueOf<T>;
      }
      const content = await fetchValKey(valModule, url);
      return (content === undefined ? null : content) as RouteValueOf<T>;
    }
    const val = valModule && (await fetchVal(valModule)).value;
    return initValRouteFromVal(
      resolvedParams,
      "fetchValRoute",
      path,
      schema,
      val,
    );
  };
};

/**
 * Resolves ONE `.jsonValues()` entry by key, loading only that entry instead of
 * the whole record — the runtime-scaling counterpart to the eager `fetchVal`.
 *
 * Production (Val disabled): the entry's lazy import from the bundle. One
 * dynamic import, no server round-trip.
 *
 * Draft mode: the entry through `/json`, which replays pending patches, so
 * uncommitted Studio edits show up; an entry the draft deleted is not there.
 */
export const initFetchValKeyStega =
  (
    valServerPromise: Promise<JsonEntryValServer>,
    isEnabled: () => Promise<boolean>,
    getCookies: () => Promise<{
      get(name: string): { name: string; value: string } | undefined;
    }>,
  ) =>
  async <T extends ResolvableModule>(
    selector: T,
    key: string,
  ): Promise<JsonEntryContentOf<T> | undefined> => {
    const { enabled, draft } = await draftForRequest({
      valServer: valServerPromise,
      isEnabled,
      getCookies,
    });
    const env = requestEnv(enabled, draft);
    return (
      await awaitResolved((settled) =>
        resolveValEntry(selector, key, env, { settled }),
      )
    ).value;
  };

const initFetchValRouteUrl = (
  config: ValConfig,
  valApiEndpoints: string,
  valServerPromise: Promise<RouteReaderValServer>,
  isEnabled: () => Promise<boolean>,
  getHeaders: () => Promise<{
    get(name: string): string | null;
  }>,
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>,
  getDraftSourcesScope: GetDraftSourcesScope,
) => {
  const fetchVal = fetchValWithReads({
    valServer: valServerPromise,
    isEnabled,
    getHeaders,
    getCookies,
    scope: getDraftSourcesScope,
  });
  return async <T extends ResolvableModule>(
    selector: T,
    params?:
      | Promise<Record<string, string | string[]>>
      | Record<string, string | string[]>
      | unknown,
  ): Promise<string | null> => {
    const resolvedParams =
      params === undefined ? undefined : await Promise.resolve(params);
    // A view is a pointer: everything below reads a path, a schema and a source
    // off this, and a pointer has none of them. See `resolveViewedModule`.
    const valModule = Internal.resolveViewedModule<SourceObject>(selector);
    // The url is made of the params and the module's path: a `.jsonValues()`
    // router's entries are not imported for it.
    const val =
      valModule && (await fetchVal(valModule, { entries: false })).value;
    return getValRouteUrlFromVal(
      resolvedParams,
      "fetchValRouteUrl",
      valModule && Internal.getValPath(valModule),
      valModule && Internal.getSchema(valModule),
      val,
    );
  };
};

const valApiEndpoints = "/api/val";

type ValNextRscConfig = {
  draftMode: typeof draftMode;
  headers: typeof headers;
  cookies: typeof cookies;
};

export function initValRsc(
  config: ValConfig,
  valModules: ValModules,
  rscNextConfig: ValNextRscConfig,
): {
  fetchValStega: ReturnType<typeof initFetchValStega>;
  fetchValKeyStega: ReturnType<typeof initFetchValKeyStega>;
  fetchValRouteStega: ReturnType<typeof initFetchValRouteStega>;
  fetchValRouteUrl: ReturnType<typeof initFetchValRouteUrl>;
} {
  const coreVersion = Internal.VERSION.core;
  if (!coreVersion) {
    throw new Error("Could not get @valbuild/core package version");
  }
  const nextVersion = VERSION;
  if (!nextVersion) {
    throw new Error("Could not get @valbuild/next package version");
  }
  const draftSourcesScope = createReactCacheScope();

  const valServerPromise = createValServer(
    valModules,
    "/api/val",
    {
      versions: {
        next: nextVersion,
        core: coreVersion,
        framework: "next",
      },
      ...config,
    },
    config,
    {
      async isEnabled() {
        return (await rscNextConfig.draftMode()).isEnabled;
      },
      async onEnable() {
        (await rscNextConfig.draftMode()).enable();
      },
      async onDisable() {
        (await rscNextConfig.draftMode()).disable();
      },
    },
  );
  return {
    fetchValStega: initFetchValStega(
      config,
      valApiEndpoints, // TODO: get from config
      valServerPromise,
      async () => {
        return (await rscNextConfig.draftMode()).isEnabled;
      },
      async () => {
        return await rscNextConfig.headers();
      },
      async () => {
        return await rscNextConfig.cookies();
      },
      draftSourcesScope,
    ),
    fetchValKeyStega: initFetchValKeyStega(
      valServerPromise,
      async () => {
        return (await rscNextConfig.draftMode()).isEnabled;
      },
      async () => {
        return await rscNextConfig.cookies();
      },
    ),
    fetchValRouteStega: initFetchValRouteStega(
      config,
      valApiEndpoints,
      valServerPromise,
      async () => {
        return (await rscNextConfig.draftMode()).isEnabled;
      },
      async () => {
        return await rscNextConfig.headers();
      },
      async () => {
        return await rscNextConfig.cookies();
      },
      draftSourcesScope,
    ),
    fetchValRouteUrl: initFetchValRouteUrl(
      config,
      valApiEndpoints,
      valServerPromise,
      async () => {
        return (await rscNextConfig.draftMode()).isEnabled;
      },
      async () => {
        return await rscNextConfig.headers();
      },
      async () => {
        return await rscNextConfig.cookies();
      },
      draftSourcesScope,
    ),
  };
}
