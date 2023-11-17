import { stegaEncode, type StegaOfSource } from "@valbuild/react/stega";
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

const initFetchVal =
  (
    valApiEndpoints: string,
    isEnabled: () => boolean,
    getHeaders: () => Headers
  ) =>
  <T extends SelectorSource>(
    selector: T
  ): SelectorOf<T> extends GenericSelector<infer S>
    ? Promise<StegaOfSource<S>>
    : never => {
    const enabled = isEnabled();
    if (enabled) {
      const host = getHost(getHeaders());
      //
      if (host) {
        // TODO: Use the content.val.build endpoints directly
        const api = new ValApi(`${host}${valApiEndpoints}`);
        // Optimize: only fetch the modules needed, also cache by module id and revalidate when patched
        // const valModuleIds = getModuleIds(selector);
        return api
          .getModules({
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
  try {
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
  } catch (err) {
    console.error(
      "Val: could not read headers! fetchVal can only be used server-side. Use useVal on clients.",
      err
    );
    return null;
  }
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function initValRsc(
  config: ValConfig,
  {
    isEnabled,
    getHeaders,
  }: {
    isEnabled: () => boolean;
    getHeaders: () => Headers;
  }
): {
  fetchVal: ReturnType<typeof initFetchVal>;
} {
  return {
    fetchVal: initFetchVal(
      valApiEndpoints, // TODO: get from config
      isEnabled,
      getHeaders
    ),
  };
}
