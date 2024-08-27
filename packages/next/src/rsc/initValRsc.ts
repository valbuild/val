import {
  SET_AUTO_TAG_JSX_ENABLED,
  stegaEncode,
  type StegaOfSource,
} from "@valbuild/react/stega";
import {
  SelectorSource,
  SelectorOf,
  GenericSelector,
  ModuleFilePath,
  PatchId,
  ValConfig,
} from "@valbuild/core";
import { cookies, draftMode, headers } from "next/headers";
import { createValClient } from "@valbuild/shared/internal";

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
      SET_AUTO_TAG_JSX_ENABLED(true);
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
        const client = createValClient(`${host}${valApiEndpoints}`);
        // TODO: use Server directly
        return client("/patches/~", "GET", {
          query: {
            omit_patch: true,
            author: [],
            patch_id: [],
            module_file_path: [],
          },
        })
          .then(async (patchesRes) => {
            if (patchesRes.status !== 200) {
              console.error("Val: could not fetch patches", patchesRes.json);
              throw Error(JSON.stringify(patchesRes.json, null, 2));
            }
            const allPatches = Object.keys(
              patchesRes.json.patches
            ) as PatchId[];
            return client("/tree/~", "PUT", {
              path: undefined,
              query: {
                validate_sources: true,
                validate_all: false,
                validate_binary_files: false,
              },
              body: { patchIds: allPatches },
            }).then((res) => {
              if (res.status === 200) {
                const { modules } = res.json;
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
                if (res.status === 401) {
                  console.warn("Val: authentication error: ", res.json.message);
                } else {
                  console.error("Val: could not fetch modules", res.json);
                  throw Error(JSON.stringify(res.json, null, 2));
                }
              }
            });
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
