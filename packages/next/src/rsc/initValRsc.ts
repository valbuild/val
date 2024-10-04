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
  ValModules,
  Internal,
} from "@valbuild/core";
import { cookies, draftMode, headers } from "next/headers";
import { VAL_SESSION_COOKIE } from "@valbuild/shared/internal";
import { createValServer, ValServer } from "@valbuild/server";
import { VERSION } from "../version";

const initFetchValStega =
  (
    config: ValConfig,
    valApiEndpoints: string,
    valServerPromise: Promise<ValServer>,
    isEnabled: () => boolean,
    getHeaders: () => Headers,
    getCookies: () => {
      get(name: string): { name: string; value: string } | undefined;
    },
  ) =>
  <T extends SelectorSource>(
    selector: T,
  ): SelectorOf<T> extends GenericSelector<infer S>
    ? Promise<StegaOfSource<S>>
    : never => {
    let enabled = false;
    try {
      enabled = isEnabled();
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
        headers = getHeaders();
        if (!(headers instanceof Headers)) {
          throw new Error(
            "Expected an instance of Headers. Check Val rsc config.",
          );
        }
      } catch (err) {
        console.error(
          "Val: could not read headers! fetchVal can only be used server-side. Use useVal on clients.",
          err,
        );
        headers = null;
      }

      const cookies = (() => {
        try {
          return getCookies();
        } catch (err) {
          console.error(
            "Val: could not read cookies! fetchVal can only be used server-side. Use useVal on clients.",
            err,
          );
          return null;
        }
      })();

      const host: string | null = headers && getHost(headers);
      if (host && cookies) {
        return valServerPromise
          .then(async (valServer) => {
            const patchesRes = await valServer["/patches/~"]["GET"]({
              query: {
                omit_patch: true,
                author: undefined,
                patch_id: undefined,
                module_file_path: undefined,
              },
              cookies: {
                [VAL_SESSION_COOKIE]: cookies.get(VAL_SESSION_COOKIE)?.value,
              },
            });
            if (patchesRes.status !== 200) {
              console.error("Val: could not fetch patches", patchesRes.json);
              throw Error(JSON.stringify(patchesRes.json, null, 2));
            }
            const allPatches = patchesRes.json.patches.map(
              (patch) => patch.patchId,
            );

            const treeRes = await valServer["/tree/~"]["PUT"]({
              path: "/",
              query: {
                validate_sources: true,
                validate_all: false,
                validate_binary_files: false,
              },
              body: { patchIds: allPatches },
              cookies: {
                [VAL_SESSION_COOKIE]: cookies.get(VAL_SESSION_COOKIE)?.value,
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
                console.warn(
                  "Val: authentication error: ",
                  treeRes.json.message,
                );
              } else {
                console.error("Val: could not fetch modules", treeRes.json);
                throw Error(JSON.stringify(treeRes.json, null, 2));
              }
            }
          })
          .catch((err) => {
            console.error("Val: failed while fetching modules", err);
            if (process.env.NODE_ENV === "development") {
              throw Error(
                "Val: Could not fetch data. This is likely due to a misconfiguration or a bug. Check the console for more details.",
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
  valModules: ValModules,
  rscNextConfig: ValNextRscConfig,
): {
  fetchValStega: ReturnType<typeof initFetchValStega>;
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
    {
      async isEnabled() {
        return rscNextConfig.draftMode().isEnabled;
      },
      async onEnable() {
        rscNextConfig.draftMode().enable();
      },
      async onDisable() {
        rscNextConfig.draftMode().disable();
      },
    },
  );
  return {
    fetchValStega: initFetchValStega(
      config,
      valApiEndpoints, // TODO: get from config
      valServerPromise,
      () => {
        return rscNextConfig.draftMode().isEnabled;
      },
      () => {
        return rscNextConfig.headers();
      },
      () => {
        return rscNextConfig.cookies();
      },
    ),
  };
}
