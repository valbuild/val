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
import { draftMode, headers } from "next/headers";
import { optimizeTreePath } from "../optimizeTreePath";

const initFetchValStega =
  (
    config: ValConfig,
    valApiEndpoints: string,
    isEnabled: () => boolean,
    getHeaders: () => Headers
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

      const host: string | null = headers && getHost(headers);
      if (host && isProxyMode(config)) {
        const api = new ValApi(`${host}${valApiEndpoints}`);
        const valModuleIds = getModuleIds(selector);
        return api
          .getTree({
            // TODO: get tree should probably have a list of ids instead
            treePath: optimizeTreePath(valModuleIds) ?? undefined,
            patch: true,
            includeSource: true,
            headers: getValAuthHeaders(getHeaders()),
          })
          .then((res) => {
            if (result.isOk(res)) {
              const { modules } = res.value;
              return stegaEncode(selector, {
                getModule: (moduleId) => {
                  const module = modules[moduleId as ModuleId];
                  if (module) {
                    return module.source;
                  }
                },
              });
            } else {
              console.error("Val: could not fetch modules", res.error);
            }
            return stegaEncode(selector, {});
          })
          .catch((err) => {
            console.error("Val: failed while checking modules", err);
            return selector;
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

function isProxyMode(opts: Record<string, string>) {
  const maybeApiKey = opts.apiKey || process.env.VAL_API_KEY;
  const maybeValSecret = opts.valSecret || process.env.VAL_SECRET;
  const isProxyMode =
    opts.mode === "proxy" ||
    (opts.mode === undefined && (maybeApiKey || maybeValSecret));

  return !!isProxyMode;
}

function getValAuthHeaders(headers: Headers): Record<string, string> {
  try {
    // parse VAL_SESSION_COOKIE from cookie header:
    const session = headers
      .get("cookie")
      ?.split(";")
      .find((c) => {
        return c.trim().startsWith(`${Internal.VAL_SESSION_COOKIE}=`);
      });
    if (session) {
      return {
        Cookie: `${Internal.VAL_SESSION_COOKIE}=${session}`,
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
      }
    ),
  };
}
