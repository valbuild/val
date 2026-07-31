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
import { VAL_SESSION_COOKIE } from "@valbuild/shared/internal";
import { createValServer, ValServer } from "@valbuild/server";
import { VERSION } from "../version";
import {
  getJsonEntryStegaRoot,
  getValRouteUrlFromVal,
  initValRouteFromVal,
  isJsonValuesRecordSchema,
} from "../routeFromVal";

SET_RSC(true);
const initFetchValStega =
  (
    config: ValConfig,
    valApiEndpoints: string,
    valServerPromise: Promise<ValServer>,
    isEnabled: () => Promise<boolean>,
    getHeaders: () => Promise<{
      get(name: string): string | null;
    }>,
    getCookies: () => Promise<{
      get(name: string): { name: string; value: string } | undefined;
    }>,
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
          const valServer = await valServerPromise;
          const treeRes = await valServer["/sources/~"]["PUT"]({
            path: "/",
            query: {
              validate_sources: true,
              validate_binary_files: false,
              exclude_patches: false,
              // RSC pre-render uses the legacy "server applies patches" path.
              apply_patches: undefined,
            },
            cookies: {
              [VAL_SESSION_COOKIE]: cookies?.get(VAL_SESSION_COOKIE)?.value,
            },
          });

          if (treeRes.status === 200) {
            const { modules } = treeRes.json;
            return stegaEncode(selector, {
              disabled: !enabled,
              getModule: (path) => {
                const module = modules[path as ModuleFilePath];
                if (module) {
                  return module.source;
                }
              },
            });
          } else {
            if (treeRes.status === 401) {
              console.warn("Val: authentication error: ", treeRes.json.message);
            } else {
              throw Error(JSON.stringify(treeRes.json, null, 2));
            }
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
    valServerPromise: Promise<ValServer>,
    isEnabled: () => Promise<boolean>,
    getHeaders: () => Promise<{
      get(name: string): string | null;
    }>,
    getCookies: () => Promise<{
      get(name: string): { name: string; value: string } | undefined;
    }>,
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
      let content: unknown = undefined;
      if (enabled && path) {
        SET_AUTO_TAG_JSX_ENABLED(true);
        content = await loadDraftJsonEntry(
          valServerPromise,
          getCookies,
          path as unknown as ModuleFilePath,
          url,
        );
      }
      if (content === undefined) {
        content = await loadJsonEntryContent(source, url);
      }
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
async function loadDraftJsonEntry(
  valServerPromise: Promise<ValServer>,
  getCookies: () => Promise<{
    get(name: string): { name: string; value: string } | undefined;
  }>,
  moduleFilePath: ModuleFilePath,
  key: string,
): Promise<unknown | undefined> {
  let cookies;
  try {
    cookies = await getCookies();
  } catch {
    // not in a server context where cookies are readable
    return undefined;
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
    },
    cookies: {
      [VAL_SESSION_COOKIE]: cookies?.get(VAL_SESSION_COOKIE)?.value,
    },
  });
  if (res.status === 200 && "content" in res.json) {
    return res.json.content;
  }
  if (res.status === 401) {
    console.warn("Val: authentication error: ", res.json.message);
    return undefined;
  }
  if (res.status === 404) {
    // No such entry in the draft state (e.g. removed by a pending patch).
    return undefined;
  }
  console.error(
    "Val: could not load draft JSON entry: ",
    "message" in res.json ? res.json.message : `status ${res.status}`,
  );
  return undefined;
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
const initFetchValKeyStega =
  (
    valServerPromise: Promise<ValServer>,
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
    let content: unknown = undefined;
    if (enabled && moduleFilePath) {
      SET_AUTO_TAG_JSX_ENABLED(true);
      content = await loadDraftJsonEntry(
        valServerPromise,
        getCookies,
        moduleFilePath,
        key,
      );
    }
    if (content === undefined) {
      content = await loadJsonEntryContent(source, key);
    }
    if (content === undefined) {
      // missing key, or transport marker without a runtime thunk
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
    valServerPromise: Promise<ValServer>,
    isEnabled: () => Promise<boolean>,
    getHeaders: () => Promise<{
      get(name: string): string | null;
    }>,
    getCookies: () => Promise<{
      get(name: string): { name: string; value: string } | undefined;
    }>,
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
    ),
  };
}
