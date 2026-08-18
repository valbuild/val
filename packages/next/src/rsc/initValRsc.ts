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
} from "@valbuild/core";
import { cookies, draftMode, headers } from "next/headers";
import { VAL_SESSION_COOKIE } from "@valbuild/shared/internal";
import {
  createValServer,
  isLiveModeConfigured,
  ValServer,
} from "@valbuild/server";
import { VERSION } from "../version";
import { getValRouteUrlFromVal, initValRouteFromVal } from "../routeFromVal";

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
      } else if (isLiveModeConfigured(config)) {
        // Live mode: render patches that are committed to Val but are not yet
        // part of this deploy, for everyone, with no login.
        //
        // NOTE: this path must not add a dynamic API. cookies() and headers()
        // opt the route out of static generation for every visitor, so
        // getHost/getCookies above stay behind `enabled` and live mode reads
        // neither: it needs nothing per-request, only the config and the
        // in-process server.
        const liveSources = await getLiveSources(valServerPromise);
        if (liveSources) {
          return stegaEncode(selector, {
            // `disabled` stays bound to draft mode, never to live mode: live
            // content is public, so no data-val-path markers may leak into the
            // HTML anonymous visitors get.
            disabled: !enabled,
            getModule: (path) => liveSources[path as ModuleFilePath],
          });
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

/**
 * The live sources for this request, or null if there are none to apply.
 *
 * Never throws: live mode is an enhancement on top of the deployed content, so
 * every failure has to degrade to rendering what was deployed. In particular it
 * must not reach the caller's catch, which re-encodes with stega enabled.
 */
async function getLiveSources(
  valServerPromise: Promise<ValServer>,
): Promise<Record<string, unknown> | null> {
  try {
    const valServer = await valServerPromise;
    const res = await valServer["/live/sources"]["GET"]({});
    if (res.status !== 200) {
      console.error("Val: could not get live sources: ", res.json.message);
      return null;
    }
    return res.json.sources;
  } catch (err) {
    console.error("Val: could not get live sources: ", err);
    return null;
  }
}

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
      ? StegaOfSource<NonNullable<S>[string]> | null
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
    const fetchVal = initFetchValStega(
      config,
      valApiEndpoints,
      valServerPromise,
      isEnabled,
      getHeaders,
      getCookies,
    );
    const resolvedParams = await Promise.resolve(params);
    const path = selector && Internal.getValPath(selector);
    const schema = selector && Internal.getSchema(selector);
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
  // valServerPromise is created here at module-eval time, but only awaited from
  // inside a fetchVal call. Without this no-op catch, a config error (a bad
  // live ttl, proxy mode without a project) rejects with no handler attached,
  // which becomes an unhandledRejection and kills the server before any request
  // is served. Every awaiting call site reports the error itself.
  valServerPromise.catch(() => {
    // handled at the call sites
  });
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
