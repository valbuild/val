import {
  getModuleIds,
  stegaEncode,
  type StegaOfSource,
} from "@valbuild/react/stega";
import {
  SelectorSource,
  SelectorOf,
  GenericSelector,
  ModuleId,
} from "@valbuild/core";
import { ValApi } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { Internal } from "@valbuild/core";
import { ValConfig } from "@valbuild/core";
import { cookies, draftMode, headers } from "next/headers";
import { optimizeTreePath } from "../optimizeTreePath";

const initFetchValStega =
  (
    config: ValConfig,
    valApiEndpoints: string,
    isEnabled: () => boolean,
    getHeaders: () => Headers,
    getCookies: () => {
      get(name: string): { name: string; value: string } | undefined;
    }
  ) =>
  <T extends SelectorSource>(
    selector: T
  ): SelectorOf<T> extends GenericSelector<infer S>
    ? Promise<StegaOfSource<S>>
    : never => {
    let enabled = false;
    try {
      enabled = isEnabled();
    } catch (err) {
      console.error(
        "Val: could not check if Val is enabled! This might be due to an error to check draftMode. fetchVal can only be used server-side. Use useVal on clients.",
        err
      );
    }

    if (enabled) {
      let headers;
      try {
        headers = getHeaders();
        if (!(headers instanceof Headers)) {
          throw new Error(
            "Expected an instance of Headers. Check Val rsc config."
          );
        }
      } catch (err) {
        console.error(
          "Val: could not read headers! fetchVal can only be used server-side. Use useVal on clients.",
          err
        );
        headers = null;
      }

      let cookies;
      try {
        cookies = getCookies();
      } catch (err) {
        console.error(
          "Val: could not read cookies! fetchVal can only be used server-side. Use useVal on clients.",
          err
        );
        cookies = null;
      }

      const host: string | null = headers && getHost(headers);
      if (host && cookies) {
        const api = new ValApi(`${host}${valApiEndpoints}`);
        const valModuleIds = getModuleIds(selector);
        return api
          .putTree({
            // TODO: get tree should probably have a list of ids instead
            treePath: optimizeTreePath(valModuleIds) ?? undefined,
            patch: true,
            includeSource: true,
            includeSchema: true,
            headers: getValAuthHeaders(cookies),
          })
          .then((res) => {
            if (result.isOk(res)) {
              const { modules } = res.value;
              return stegaEncode(selector, {
                disabled: !enabled,
                getModule: (moduleId) => {
                  const module = modules[moduleId as ModuleId];
                  if (module) {
                    return module.source;
                  }
                },
              });
            } else {
              if (res.error.statusCode === 401) {
                console.warn("Val: authentication error: ", res.error.message);
              } else {
                console.error("Val: could not fetch modules", res.error);
                throw Error(JSON.stringify(res.error, null, 2));
              }
            }
          })
          .catch((err) => {
            console.error("Val: failed while fetching modules", err);
            if (process.env.NODE_ENV === "development") {
              throw Error(
                "Val: Could not fetch data. This is likely due to a misconfiguration or a bug. Check the console for more details."
              );
            }
            return stegaEncode(selector, {});
          }) as SelectorOf<T> extends GenericSelector<infer S>
          ? Promise<StegaOfSource<S>>
          : never;
      }
    }
    return stegaEncode(selector, {
      disabled: !enabled,
    });
  };

function getHost(headers: Headers) {
  // TODO: does NextJs have a way to determine this?
  const host = headers.get("host");
  let proto = "https";
  if (headers.get("x-forwarded-proto") === "http") {
    proto = "http";
  } else if (headers.get("referer")?.startsWith("http://")) {
    proto = "http";
  } else if (host?.startsWith("localhost")) {
    proto = "http";
  }
  if (host && proto) {
    return `${proto}://${host}`;
  }
  return null;
}

function getValAuthHeaders(cookies: {
  get(name: string): { name: string; value: string } | undefined;
}): Record<string, string> {
  try {
    const session = cookies.get(Internal.VAL_SESSION_COOKIE);
    if (session) {
      return {
        Cookie: `${Internal.VAL_SESSION_COOKIE}=${encodeURIComponent(
          session.value
        )}`,
      };
    }
    return {};
  } catch (err) {
    console.error(
      "Val: could not read cookies! fetchVal can only be used server-side. Use useVal on clients.",
      err
    );
    return {};
  }
}

const valApiEndpoints = "/api/val";

type ValNextRscConfig = {
  draftMode: typeof draftMode;
  headers: typeof headers;
  cookies: typeof cookies;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initValRsc(
  config: ValConfig,
  rscNextConfig: ValNextRscConfig
): {
  fetchValStega: ReturnType<typeof initFetchValStega>;
} {
  return {
    fetchValStega: initFetchValStega(
      config,
      valApiEndpoints, // TODO: get from config
      () => {
        return rscNextConfig.draftMode().isEnabled;
      },
      () => {
        return rscNextConfig.headers();
      },
      () => {
        return rscNextConfig.cookies();
      }
    ),
  };
}
