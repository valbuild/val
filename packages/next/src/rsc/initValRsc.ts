import {
  SET_AUTO_TAG_JSX_ENABLED,
  SET_RSC,
  stegaEncode,
  type StegaOfSource,
} from "@valbuild/react/stega";
import {
  SelectorSource,
  SelectorOf,
  GenericSelector,
  ModuleFilePath,
  ValConfig,
  ValModules,
  Internal,
  ValModule,
  SourceObject,
  JsonSource,
} from "@valbuild/core";
import { cookies, draftMode, headers } from "next/headers";
import { cache } from "react";
import {
  VAL_SESSION_COOKIE,
  memoizePerRequest,
  type RequestScopedMemo,
} from "@valbuild/shared/internal";
import { createValServer, ValServer } from "@valbuild/server";
import { VERSION } from "../version";
import {
  getJsonEntryStegaRoot,
  getValRouteUrlFromVal,
  initValRouteFromVal,
  isJsonValuesRecordSchema,
} from "../routeFromVal";

SET_RSC(true);

/**
 * The `modules` map every `fetchVal` in one render shares.
 *
 * Derived from the route's own response type rather than restated, so it cannot
 * drift from what `/sources/~` actually returns.
 */
export type DraftSources = Extract<
  Awaited<ReturnType<ValServer["/sources/~"]["PUT"]>>,
  { status: 200 }
>["json"]["modules"];

/**
 * The slice of `ValServer` the draft-sources reader uses.
 *
 * Narrower than `ValServer` for the same reason `JsonEntryValServer` below is:
 * it says what the dependency IS, and it lets a test drive the reader with a
 * one-route fake instead of casting a partial object to the whole server type.
 */
export type DraftSourcesValServer = Pick<ValServer, "/sources/~">;

/** What the route readers need: the tree, plus the single-entry route. */
export type RouteReaderValServer = Pick<ValServer, "/sources/~" | "/json">;

/**
 * Where the reader gets its per-request memo box.
 *
 * Injected rather than reached for, so that "this reader needs a request to
 * scope its cache to" is part of its contract and a test can supply a scope it
 * controls — in jest, React's non-`react-server` build makes `cache` a
 * pass-through, so the real wiring memoises nothing there.
 */
export type GetDraftSourcesScope =
  () => Promise<RequestScopedMemo<DraftSources | null> | null>;

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
function createReactCacheScope(): GetDraftSourcesScope {
  const getBox = cache((): RequestScopedMemo<DraftSources | null> => ({}));
  return async () => getBox();
}

/**
 * ONE read of the whole module tree, for the session in `sessionCookie`.
 *
 * `path` stays `"/"` on purpose, and the measurement is why. `/sources/~`
 * evaluates, previews and validates EVERY module and only THEN filters the
 * response by `req.path` (the two TODOs in `ValServer.ts` say so), so narrowing
 * the path shrinks the answer and changes the work not at all: on a 60-module
 * project, `path: "/"` took 53.6ms and a single-module path 53.5ms. And this is
 * an in-process call rather than a round trip, so the object it builds is never
 * serialised or sent anywhere — the bytes it saves are not bytes anyone pays
 * for. Narrowing would also give each caller a different answer to cache, which
 * is what would cost the saving that IS real (2.7x on the same project).
 *
 * `draftRead.perf.test.ts` prints both numbers; re-run it before believing
 * anything different.
 *
 * Returns `null` when the session is not one the server accepts; the caller
 * then renders published content, which is what it did before.
 */
async function loadDraftSources(
  valServerPromise: Promise<DraftSourcesValServer>,
  sessionCookie: string | undefined,
): Promise<DraftSources | null> {
  const valServer = await valServerPromise;
  const treeRes = await valServer["/sources/~"]["PUT"]({
    path: "/",
    query: {
      validate_sources: true,
      validate_binary_files: false,
      exclude_patches: false,
      // RSC pre-render uses the legacy "server applies patches" path.
      apply_patches: undefined,
      /*
       * The caller's own staged work, and nobody else's.
       *
       * A draft render cannot name its group ids — it has no client
       * state — so it asks for "mine" and the server resolves them from
       * the session. Without this a preview shows base + every pending
       * patch on the branch, so one person's half-finished edit appears
       * in another person's draft.
       *
       * `patch_id` stays `undefined`: naming an explicit list is for a
       * caller that already knows what it wants, and it would override
       * the resolution rather than intersect with it.
       */
      patch_id: undefined,
      own_patch_groups_only: true,
    },
    cookies: {
      [VAL_SESSION_COOKIE]: sessionCookie,
    },
  });
  if (treeRes.status === 200) {
    return treeRes.json.modules;
  }
  if (treeRes.status === 401) {
    console.warn("Val: authentication error: ", treeRes.json.message);
    return null;
  }
  throw Error(JSON.stringify(treeRes.json, null, 2));
}

export const initFetchValStega =
  (
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
  <T extends SelectorSource>(
    selector: T,
  ): Promise<
    SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never
  > => {
    const exec = async (): Promise<
      SelectorOf<T> extends GenericSelector<infer S> ? StegaOfSource<S> : never
    > => {
      let enabled = false;
      try {
        enabled = await isEnabled();
      } catch (err) {
        console.error(
          "Val: could not check if Val is enabled! This might be due to an error to check draftMode. fetchVal can only be used server-side. Use useVal on clients.",
          err,
        );
      }
      if (enabled) {
        SET_AUTO_TAG_JSX_ENABLED(true);
        let headers;
        try {
          headers = await getHeaders();
          if (typeof headers.get !== "function") {
            throw new Error("Invalid headers");
          }
        } catch (err) {
          console.error(
            "Val: could not read headers! fetchVal can only be used server-side. Use useVal on clients.",
            err,
          );
          headers = null;
        }

        let cookies: {
          get(name: string): { name: string; value: string } | undefined;
        } | null;
        try {
          cookies = await getCookies();
        } catch (err) {
          console.error(
            "Val: could not read cookies! fetchVal can only be used server-side. Use useVal on clients.",
            err,
          );
          cookies = null;
        }

        const host: string | null = headers && getHost(headers);
        if (host && cookies) {
          const sessionCookie = cookies?.get(VAL_SESSION_COOKIE)?.value;
          /*
           * Once per request, however many times the page reads.
           *
           * Every `fetchVal` in one render asks the same question — same query,
           * same session — so the second and third answer were identical and
           * cost the same as the first. `fetchValRouteUrl` made that worse by
           * calling `fetchVal` again on top of the caller's own.
           *
           * The key is the session, so a box that somehow outlived its request
           * misses rather than serving another author's draft. See
           * `memoizePerRequest`.
           */
          const modules = await memoizePerRequest(
            await getDraftSourcesScope(),
            sessionCookie ?? "",
            () => loadDraftSources(valServerPromise, sessionCookie),
          );
          if (modules) {
            return stegaEncode(selector, {
              disabled: !enabled,
              getModule: (path) => {
                const module = modules[path as ModuleFilePath];
                if (module) {
                  return module.source;
                }
              },
            });
          }
        }
      }
      return stegaEncode(selector, {
        disabled: !enabled,
      });
    };
    return exec().catch((err) => {
      console.error("Val: failed to fetch ", err);
      return stegaEncode(selector, {});
    });
  };

function getHost(headers: { get(name: string): string | null } | undefined) {
  // TODO: does NextJs have a way to determine this?
  const host = headers?.get("host");
  let proto = "https";
  if (headers?.get("x-forwarded-proto") === "http") {
    proto = "http";
  } else if (headers?.get("referer")?.startsWith("http://")) {
    proto = "http";
  } else if (host?.startsWith("localhost")) {
    proto = "http";
  }
  if (host && proto) {
    return `${proto}://${host}`;
  }
  return null;
}

// TODO: remove
// function getValAuthHeaders(cookies: {
//   get(name: string): { name: string; value: string } | undefined;
// }): Record<string, string> {
//   try {
//     const session = cookies.get(Internal.VAL_SESSION_COOKIE);
//     if (session) {
//       return {
//         Cookie: `${Internal.VAL_SESSION_COOKIE}=${encodeURIComponent(
//           session.value
//         )}`,
//       };
//     }
//     return {};
//   } catch (err) {
//     console.error(
//       "Val: could not read cookies! fetchVal can only be used server-side. Use useVal on clients.",
//       err
//     );
//     return {};
//   }
// }

type FetchValRouteReturnType<
  T extends ValModule<GenericSelector<SourceObject>>,
> =
  T extends ValModule<infer S>
    ? S extends SourceObject
      ? // `.jsonValues()` router: the matched entry resolves to its json content.
        NonNullable<S>[string] extends JsonSource<infer C>
        ? C | null
        : StegaOfSource<NonNullable<S>[string]> | null
      : never
    : never;

const initFetchValRouteStega =
  (
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
  ) =>
  async <T extends ValModule<GenericSelector<SourceObject>>>(
    selector: T,
    params:
      | Promise<Record<string, string | string[]>>
      | Record<string, string | string[]>
      | unknown,
  ): Promise<FetchValRouteReturnType<T>> => {
    const resolvedParams = await Promise.resolve(params);
    const path = selector && Internal.getValPath(selector);
    const schema = selector && Internal.getSchema(selector);
    // `.jsonValues()` router: map params → the entry key and load ONLY that
    // entry's backing `*.val.json`, instead of eagerly resolving the whole
    // record via `fetchVal`.
    if (isJsonValuesRecordSchema(schema)) {
      const source = selector && Internal.getSource(selector);
      const url = getValRouteUrlFromVal(
        resolvedParams,
        "fetchValRoute",
        path,
        schema,
        source,
      );
      if (!url) {
        return null as FetchValRouteReturnType<T>;
      }
      let enabled = false;
      try {
        enabled = await isEnabled();
      } catch {
        // not in a server context where draftMode is readable — treat as disabled
      }
      let draft: DraftJsonEntry = { status: "unavailable" };
      if (enabled && path) {
        SET_AUTO_TAG_JSX_ENABLED(true);
        draft = await loadDraftJsonEntry(
          valServerPromise,
          getCookies,
          path as unknown as ModuleFilePath,
          url,
        );
      }
      const content = await resolveDraftOrCommittedEntry(draft, () =>
        loadJsonEntryContent(source, url),
      );
      if (content === undefined) {
        return null as FetchValRouteReturnType<T>;
      }
      return stegaEncode(content, {
        disabled: !enabled,
        root: getJsonEntryStegaRoot(selector, url),
      });
    }
    const fetchVal = initFetchValStega(
      config,
      valApiEndpoints,
      valServerPromise,
      isEnabled,
      getHeaders,
      getCookies,
      getDraftSourcesScope,
    );
    const val = selector && (await fetchVal(selector));
    const route = initValRouteFromVal(
      resolvedParams,
      "fetchValRoute",
      path,
      schema,
      val,
    );
    return route;
  };

/**
 * Resolves a single `.jsonValues()` entry's content by key from a module's local
 * source markers (one dynamic import). Returns `undefined` when the key is
 * missing or its marker has no runtime thunk (transport marker / draft entry).
 */
async function loadJsonEntryContent(
  source: unknown,
  key: string,
): Promise<unknown | undefined> {
  if (!source || typeof source !== "object") {
    return undefined;
  }
  const marker = (source as Record<string, unknown>)[key];
  if (!Internal.isJson(marker)) {
    return undefined;
  }
  const thunk = Internal.getJsonImport(marker);
  if (!thunk) {
    return undefined;
  }
  return (await thunk()).default;
}

/**
 * Loads a single `.jsonValues()` entry's DRAFT content via the in-process
 * `/json` endpoint (which replays pending patches). Returns `undefined` when the
 * entry has no draft content to serve — the caller then falls back to the
 * locally-bundled committed content.
 */
/**
 * What the draft state says about an entry.
 *
 * The three cases have to stay distinct: `absent` is an ANSWER — the entry is not
 * there in the draft state, e.g. a pending patch removed it — while `unavailable`
 * means we could not ask. Collapsing them into `undefined` is what made a
 * draft-deleted entry keep rendering its committed content: the caller could not
 * tell "it is gone" from "ask the committed source instead".
 */
/**
 * The slice of `ValServer` the single-entry readers actually use. Narrower than
 * `ValServer` on purpose: it says what the dependency IS, and it lets a test
 * drive these readers with a one-route fake instead of casting a partial object
 * to the whole server type.
 */
export type JsonEntryValServer = Pick<ValServer, "/json">;

export type DraftJsonEntry =
  | { status: "content"; content: unknown }
  | { status: "absent" }
  | { status: "unavailable" };

/**
 * Picks the content a draft-aware single-entry read should render.
 *
 * The rule the two callers share: the draft state WINS when it has an answer —
 * including the answer "this entry is gone" — and the committed content is used
 * only when there is no draft answer to be had (Val disabled, or we could not
 * ask). Returning `undefined` means "render nothing"; both callers turn that into
 * a null/undefined result.
 */
export async function resolveDraftOrCommittedEntry(
  draft: DraftJsonEntry,
  loadCommitted: () => Promise<unknown | undefined>,
): Promise<unknown | undefined> {
  if (draft.status === "content") {
    return draft.content;
  }
  if (draft.status === "absent") {
    // Falling back here would render an entry the editor has just deleted.
    return undefined;
  }
  return loadCommitted();
}

async function loadDraftJsonEntry(
  valServerPromise: Promise<JsonEntryValServer>,
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>,
  moduleFilePath: ModuleFilePath,
  key: string,
): Promise<DraftJsonEntry> {
  let cookies;
  try {
    cookies = await getCookies();
  } catch {
    // not in a server context where cookies are readable
    return { status: "unavailable" };
  }
  const valServer = await valServerPromise;
  const res = await valServer["/json"]["GET"]({
    query: {
      path: moduleFilePath,
      key,
      keys: undefined, // single-entry shape
      offset: undefined,
      limit: undefined,
      apply_patches: true,
      /*
       * Scoped the same way the module content beside it is.
       *
       * A draft page renders both, and this call was unscoped — so one page
       * showed base + the caller's group for its modules and base + EVERY
       * pending patch on the branch for any `jsonValues` entry, including other
       * authors' half-finished edits. See the same flag on `/sources/~` above.
       */
      own_patch_groups_only: true,
    },
    cookies: {
      [VAL_SESSION_COOKIE]: cookies?.get(VAL_SESSION_COOKIE)?.value,
    },
  });
  if (res.status === 200 && "content" in res.json) {
    return { status: "content", content: res.json.content };
  }
  if (res.status === 401) {
    console.warn("Val: authentication error: ", res.json.message);
    return { status: "unavailable" };
  }
  if (res.status === 404) {
    // Authoritative: the draft state has no such entry (removed by a pending
    // patch, or never existed). Not a reason to fall back to committed content.
    return { status: "absent" };
  }
  console.error(
    "Val: could not load draft JSON entry: ",
    "message" in res.json ? res.json.message : `status ${res.status}`,
  );
  return { status: "unavailable" };
}

// The (loosened) content type a single `.jsonValues()` entry resolves to.
type JsonEntryContentOf<T extends ValModule<GenericSelector<SourceObject>>> =
  T extends ValModule<infer S>
    ? S extends Record<string, infer V>
      ? V extends JsonSource<infer C>
        ? C
        : never
      : never
    : never;

/**
 * Resolves ONE `.jsonValues()` entry by key, loading only that entry instead of
 * the whole record — the runtime-scaling counterpart to the eager `fetchVal`.
 *
 * Production (Val disabled): resolves the entry's lazy import thunk from the
 * locally-bundled module. One dynamic import, no server round-trip.
 *
 * Enabled (draft mode): reads the entry through `/json`, which replays pending
 * patches, so uncommitted Studio edits show up. Falls back to the local thunk if
 * the draft read yields nothing.
 */
export const initFetchValKeyStega =
  (
    valServerPromise: Promise<JsonEntryValServer>,
    isEnabled: () => Promise<boolean>,
    getCookies: () => Promise<{
      get(name: string): { name: string; value: string } | undefined;
    }>,
  ) =>
  async <T extends ValModule<GenericSelector<SourceObject>>>(
    selector: T,
    key: string,
  ): Promise<JsonEntryContentOf<T> | undefined> => {
    let enabled = false;
    try {
      enabled = await isEnabled();
    } catch {
      // not in a server context where draftMode is readable — treat as disabled
    }
    const source = selector && Internal.getSource(selector);
    const moduleFilePath =
      selector && (Internal.getValPath(selector) as unknown as ModuleFilePath);
    let draft: DraftJsonEntry = { status: "unavailable" };
    if (enabled && moduleFilePath) {
      SET_AUTO_TAG_JSX_ENABLED(true);
      draft = await loadDraftJsonEntry(
        valServerPromise,
        getCookies,
        moduleFilePath,
        key,
      );
    }
    const content = await resolveDraftOrCommittedEntry(draft, () =>
      loadJsonEntryContent(source, key),
    );
    if (content === undefined) {
      // deleted in the draft state, a missing key, or a transport marker with no
      // runtime thunk
      return undefined;
    }
    return stegaEncode(content, {
      disabled: !enabled,
      root: getJsonEntryStegaRoot(selector, key),
    });
  };

const initFetchValRouteUrl =
  (
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
  ) =>
  async <T extends ValModule<GenericSelector<SourceObject>>>(
    selector: T,
    params?:
      | Promise<Record<string, string | string[]>>
      | Record<string, string | string[]>
      | unknown,
  ): Promise<string | null> => {
    const fetchVal = initFetchValStega(
      config,
      valApiEndpoints,
      valServerPromise,
      isEnabled,
      getHeaders,
      getCookies,
      getDraftSourcesScope,
    );
    const resolvedParams =
      params === undefined ? undefined : await Promise.resolve(params);
    const path = selector && Internal.getValPath(selector);
    const schema = selector && Internal.getSchema(selector);
    const val = selector && (await fetchVal(selector));
    const route = getValRouteUrlFromVal(
      resolvedParams,
      "fetchValRouteUrl",
      path,
      schema,
      val,
    );
    return route;
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
