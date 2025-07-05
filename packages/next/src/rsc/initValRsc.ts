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
  RecordSchema,
} from "@valbuild/core";
import { cookies, draftMode, headers } from "next/headers";
import {
  getNextAppRouterSourceFolder,
  getPatternFromModuleFilePath,
  parseRoutePattern,
  RoutePattern,
  VAL_SESSION_COOKIE,
} from "@valbuild/shared/internal";
import { createValServer, ValServer } from "@valbuild/server";
import { VERSION } from "../version";

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
      | Record<string, string | string[]>,
  ): Promise<FetchValRouteReturnType<T>> => {
    const fetchVal = initFetchValStega(
      config,
      valApiEndpoints,
      valServerPromise,
      isEnabled,
      getHeaders,
      getCookies,
    );
    const path = selector && Internal.getValPath(selector);
    if (!path) {
      console.error(
        "Val: fetchValRoute can only be used with a Val module (details: no Val path found).",
      );
      return null as T extends ValModule<infer S>
        ? S extends SourceObject
          ? StegaOfSource<NonNullable<S>[string]> | null
          : never
        : never;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val: any = await fetchVal(selector);
    if (val === null) {
      return null as FetchValRouteReturnType<T>;
    }
    if (typeof val !== "object") {
      console.error(
        `Val: fetchValRoute must be used with a Val Module that is a s.record().router(...) (details: expected type object, found ${typeof val} instead).`,
      );
      return null as FetchValRouteReturnType<T>;
    }
    if (Array.isArray(val)) {
      console.error(
        "Val: fetchValRoute must be used with a Val Module that is a s.record().router(...) (details: expected type object, found array instead).",
      );
      return null as FetchValRouteReturnType<T>;
    }
    const schema = Internal.getSchema(selector);
    if (!schema) {
      console.error(
        "Val: fetchValRoute must be used with a Val Module that is a s.record().router(...) (details: no schema found).",
      );
      return null as FetchValRouteReturnType<T>;
    }
    if (!(schema instanceof RecordSchema)) {
      console.error(
        "Val: fetchValRoute must be used with a Val Module that is a s.record().router(...) (details: schema is not a record).",
      );
    } else if (!schema["currentRouter"]) {
      console.error(
        "Val: fetchValRoute must be used with a Val Module that is a s.record().router(...) (details: router is not set).",
      );
    } else if (
      schema["currentRouter"].getRouterId() !==
      Internal.nextAppRouter.getRouterId()
    ) {
      console.error(
        "Val: fetchValRoute must be used with a Val Module that is a s.record().router(...) (details: router is not the Next.js App Router).",
      );
      return null as FetchValRouteReturnType<T>;
    }
    const resolvedParams = await Promise.resolve(params);
    if (typeof resolvedParams !== "object") {
      console.error(
        "Val: fetchValRoute must be used with a Val Module that is a s.record().router(...) (details: params is not an object).",
      );
      return null as FetchValRouteReturnType<T>;
    }
    const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
    if (
      !(
        moduleFilePath.endsWith("page.val.ts") ||
        moduleFilePath.endsWith("page.val.js")
      )
    ) {
      console.error(
        `Val: fetchValRoute is used with a Val module that does not have a page.val.ts or page.val.js file. Make sure the Val module is in the same directory as your page.tsx or page.js file.`,
      );
      return null as FetchValRouteReturnType<T>;
    }
    const srcFolder = getNextAppRouterSourceFolder(
      moduleFilePath as ModuleFilePath,
    );
    if (!srcFolder) {
      console.error(
        "Val: fetchValRoute was used with a Val module that is not in the /app or /src/app folder",
      );
      return null as FetchValRouteReturnType<T>;
    }
    const pattern = getPatternFromModuleFilePath(moduleFilePath, srcFolder);
    const parsedPattern = parseRoutePattern(pattern);
    const missingPatterns: RoutePattern[] = [];
    const fullPathParts: string[] = [];
    const missingParamKeys = { ...resolvedParams };
    for (const part of parsedPattern ?? []) {
      if (part.type === "literal") {
        fullPathParts.push(part.name);
      } else if (part.type === "array-param" || part.type === "string-param") {
        const value = resolvedParams[part.paramName];
        if (typeof value !== "string" && !Array.isArray(value)) {
          missingPatterns.push(part);
        } else if (Array.isArray(value)) {
          delete missingParamKeys[part.paramName];
          fullPathParts.push(value.join("/"));
        } else {
          delete missingParamKeys[part.paramName];
          fullPathParts.push(value);
        }
      }
    }
    if (missingPatterns.length > 0) {
      const errorMessageParams = missingPatterns.map((part) => {
        if (part.type === "literal") {
          return part.name;
        } else if (part.type === "string-param") {
          return `[${part.paramName}]`;
        } else if (part.type === "array-param") {
          return `[...${part.paramName}]`;
        }
      });
      console.error(
        `Val: fetchValRoute could not find route since parameters: ${errorMessageParams.join(", ")} where not provided. Make sure the Val module is in the same directory as your page.tsx or page.js file and that the Val module filename is called page.val.ts or page.val.js.`,
      );
      return null as FetchValRouteReturnType<T>;
    }
    if (Object.keys(missingParamKeys).length > 0) {
      console.error(
        `Val: fetchValRoute could not find route since parameters: ${Object.keys(missingParamKeys).join(", ")} where not found in the path of: ${moduleFilePath}. Make sure  ${moduleFilePath} in the same directory as your page.tsx or page.js file.`,
      );
      // We do not return null here since we found a route that matches the path
      // though chances are that there's something wrong in the way fetchValRoute is used
    }
    const fullPath = fullPathParts.join("/");
    const actualRoute = val[`/${fullPath}`];
    if (!actualRoute) {
      return null as FetchValRouteReturnType<T>;
    }
    return actualRoute;
  };

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
  fetchValRouteStega: ReturnType<typeof initFetchValRouteStega>;
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
  };
}
