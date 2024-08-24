import { promises as fs } from "fs";
import * as path from "path";
import { Internal, ValConfig, ValModules } from "@valbuild/core";
import {
  Api,
  ApiEndpoint,
  ValServerGenericResult,
} from "@valbuild/shared/internal";
import { createUIRequestHandler } from "@valbuild/ui/server";
import { ValServer, ValServerCallbacks, ValServerConfig } from "./ValServer";
import { fromError, fromZodError } from "zod-validation-error";
import { z } from "zod";

type Versions = {
  versions?: {
    core?: string;
    next?: string;
  };
};
export type ValApiOptions = ValServerOverrides & ValConfig & Versions;

type ValServerOverrides = Partial<{
  /**
   * Override the Val API key.
   *
   * Typically this is set using VAL_API_KEY env var.
   *
   * NOTE: if this is set you must also set valSecret or VAL_SECRET env var.
   */
  apiKey: string;
  /**
   * Override the Val session key.
   *
   * This can be any randomly generated string.
   * It will be used for authentication between the frontend and val api
   * endpoints in this app.
   *
   * Typically this is set using VAL_SECRET env var.
   *
   * NOTE: if this is set you must also set apiKey or VAL_API_KEY env var.
   */
  valSecret: string;
  /**
   * Override the default the mode of operation.
   *
   * Typically this should not be set.
   *
   * "local" means that changes will be written to the local filesystem,
   * which is what you want when developing locally.
   *
   * "proxy" means that changes will proxied to https://app.val.build
   * and eventually be committed in the Git repository.
   *
   * It will automatically be "proxy" if both VAL_API_KEY env var (or the apiKey property) and VAL_SECRET env var (or the valSecret property)
   * is set.
   *
   * If both is missing, it will default to "local".
   */
  mode: "proxy" | "local";
  /**
   * Current git commit.
   *
   * Required if mode is "proxy".
   *
   * @example "e83c5163316f89bfbde7d9ab23ca2e25604af290"
   */
  gitCommit: string;

  /**
   * Current git branch.
   *
   * Required if mode is "proxy".
   *
   * @example "main"
   */
  gitBranch: string;
  /**
   * The base url of Val.
   *
   * Typically this should not be set.
   *
   * Can also be overridden using the VAL_BUILD_URL env var.
   *
   * @example "https://app.val.build"
   */
  valBuildUrl: string;
  /**
   * The base url of Val content.
   *
   * Typically this should not be set.
   *
   * Can also be overridden using the VAL_CONTENT_URL env var.
   *
   * @example "https://content.val.build"
   */
  valContentUrl: string;
  /**
   * The full project name of the Val project.
   *
   * @example "myorg/my-project"
   */
  project: string;
  /**
   * After Val is enabled, redirect to this url.
   *
   * May be used to setup a custom flow after enabling Val.
   *
   *This can be set using the VAL_ENABLE_REDIRECT_URL env var.
   *
   * @example "/api/draft/enable"
   */
  valEnableRedirectUrl?: string;
  /**
   * After Val is disabled, redirect to this url.
   *
   * May be used to setup a custom flow after disabling Val.
   *
   * This can be set using the VAL_DISABLE_REDIRECT_URL env var.
   *
   * @example "/api/draft/enable"
   */
  valDisableRedirectUrl?: string;
  /**
   * Disable the cache.
   */
  disableCache?: boolean;
}>;

export async function createValServer(
  valModules: ValModules,
  route: string,
  opts: ValApiOptions,
  callbacks: ValServerCallbacks,
  formatter?: (code: string, filePath: string) => string | Promise<string>
): Promise<ValServer> {
  const valServerConfig = await initHandlerOptions(route, opts);
  return ValServer(
    valModules,
    {
      formatter,
      ...valServerConfig,
    },
    callbacks
  );
}

async function initHandlerOptions(
  route: string,
  opts: ValApiOptions
): Promise<ValServerConfig> {
  const maybeApiKey = opts.apiKey || process.env.VAL_API_KEY;
  const maybeValSecret = opts.valSecret || process.env.VAL_SECRET;
  const isProxyMode =
    opts.mode === "proxy" ||
    (opts.mode === undefined && (maybeApiKey || maybeValSecret));
  const valEnableRedirectUrl =
    opts.valEnableRedirectUrl || process.env.VAL_ENABLE_REDIRECT_URL;
  const valDisableRedirectUrl =
    opts.valDisableRedirectUrl || process.env.VAL_DISABLE_REDIRECT_URL;

  const maybeValProject = opts.project || process.env.VAL_PROJECT;
  const valBuildUrl =
    opts.valBuildUrl || process.env.VAL_BUILD_URL || "https://app.val.build";
  if (isProxyMode) {
    if (!maybeApiKey || !maybeValSecret) {
      throw new Error(
        "VAL_API_KEY and VAL_SECRET env vars must both be set in proxy mode"
      );
    }
    const valContentUrl =
      opts.valContentUrl ||
      process.env.VAL_CONTENT_URL ||
      "https://content.val.build";
    const maybeGitCommit = opts.gitCommit || process.env.VAL_GIT_COMMIT;
    if (!maybeGitCommit) {
      throw new Error("VAL_GIT_COMMIT env var must be set in proxy mode");
    }
    const maybeGitBranch = opts.gitBranch || process.env.VAL_GIT_BRANCH;
    if (!maybeGitBranch) {
      throw new Error("VAL_GIT_BRANCH env var must be set in proxy mode");
    }
    if (!maybeValProject) {
      throw new Error(
        "Proxy mode does not work unless the 'project' option in val.config is defined or the VAL_PROJECT env var is set."
      );
    }
    const coreVersion = opts.versions?.core;
    if (!coreVersion) {
      throw new Error("Could not determine version of @valbuild/core");
    }
    const nextVersion = opts.versions?.next;
    if (!nextVersion) {
      throw new Error("Could not determine version of @valbuild/next");
    }

    return {
      mode: "http",
      route,
      apiKey: maybeApiKey,
      valSecret: maybeValSecret,
      commit: maybeGitCommit,
      branch: maybeGitBranch,
      root: opts.root,
      project: maybeValProject,
      valEnableRedirectUrl,
      valDisableRedirectUrl,
      valContentUrl,
      valBuildUrl,
    };
  } else {
    const cwd = process.cwd();
    const valBuildUrl =
      opts.valBuildUrl || process.env.VAL_BUILD_URL || "https://app.val.build";
    return {
      mode: "fs",
      cwd,
      route,
      valDisableRedirectUrl,
      valEnableRedirectUrl,
      valBuildUrl,
      apiKey: maybeApiKey,
      valSecret: maybeValSecret,
      project: maybeValProject,
    };
  }
}

// TODO: remove
export async function safeReadGit(
  cwd: string
): Promise<{ commit?: string; branch?: string }> {
  async function findGitHead(
    currentDir: string,
    depth: number
  ): Promise<{ commit?: string; branch?: string }> {
    const gitHeadPath = path.join(currentDir, ".git", "HEAD");
    if (depth > 1000) {
      console.error(
        `Reached max depth while scanning for .git folder. Current working dir: ${cwd}.`
      );
      return {
        commit: undefined,
        branch: undefined,
      };
    }

    try {
      const headContents = await fs.readFile(gitHeadPath, "utf-8");
      const match = headContents.match(/^ref: refs\/heads\/(.+)/);
      if (match) {
        const branchName = match[1];
        return {
          branch: branchName,
          commit: await readCommit(currentDir, branchName),
        };
      } else {
        return {
          commit: undefined,
          branch: undefined,
        };
      }
    } catch (error) {
      const parentDir = path.dirname(currentDir);

      // We've reached the root directory
      if (parentDir === currentDir) {
        return {
          commit: undefined,
          branch: undefined,
        };
      }
      return findGitHead(parentDir, depth + 1);
    }
  }

  try {
    return findGitHead(cwd, 0);
  } catch (err) {
    console.error("Error while reading .git", err);
    return {
      commit: undefined,
      branch: undefined,
    };
  }
}

async function readCommit(
  gitDir: string,
  branchName: string
): Promise<string | undefined> {
  try {
    return (
      await fs.readFile(
        path.join(gitDir, ".git", "refs", "heads", branchName),
        "utf-8"
      )
    ).trim();
  } catch (err) {
    return undefined;
  }
}

export function createValApiRouter<Res>(
  route: string,
  valServerPromise: Promise<ValServer>,
  convert: (valServerRes: ValServerGenericResult) => Res
): (req: Request) => Promise<Res> {
  const uiRequestHandler = createUIRequestHandler();
  return async (req): Promise<Res> => {
    const valServer = await valServerPromise;
    const url = new URL(req.url);
    if (!url.pathname.startsWith(route)) {
      const error = {
        message: "Val: routes are not configured correctly",
        details: `Check you api routes. Expected pathname to start with "${route}", but it was: "${url.pathname}"`,
      };
      console.error(error);
      return convert({
        status: 500,
        json: error,
      });
    }

    const path = url.pathname.slice(route.length);
    const groupQueryParams = (arr: [string, string][]) => {
      const map: Record<string, string[]> = {};
      for (const [key, value] of arr) {
        const list = map[key] || [];
        list.push(value);
        map[key] = list;
      }
      return map;
    };
    async function getValServerResponse(
      reqApiRoutePath: string,
      req: Request
    ): Promise<ValServerGenericResult> {
      const anyApi =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Api as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyValServer = valServer as any;
      const method = req.method?.toUpperCase();
      let route = null;
      let path: string | undefined = undefined;
      for (const routeDef of Object.keys(Api)) {
        if (routeDef === reqApiRoutePath) {
          route = routeDef;
          break;
        }
        if (reqApiRoutePath.startsWith(routeDef)) {
          const reqDefinition = (anyApi?.[routeDef]?.[method] as ApiEndpoint)
            .req;
          if (reqDefinition) {
            route = routeDef;
            if (reqDefinition.path) {
              const subPath = reqApiRoutePath.slice(routeDef.length);
              const pathRes = reqDefinition.path.safeParse(subPath);
              if (!pathRes.success) {
                return zodErrorResult(
                  pathRes.error,
                  `invalid path: '${subPath}' endpoint: '${routeDef}'`
                );
              } else {
                path = pathRes.data;
              }
            }
            break;
          }
        }
      }

      if (!route) {
        return {
          status: 404,
          json: {
            message: "Route not found. Valid routes are: " + Object.keys(Api),
            details: {
              route,
              method,
            },
          },
        };
      }

      const apiEndpoint = anyApi?.[route]?.[method] as ApiEndpoint;
      const reqDefinition = apiEndpoint.req;
      if (!reqDefinition) {
        return {
          status: 404,
          json: {
            message: `Requested method ${method} on route ${route} is not valid. Valid methods are: ${Object.keys(
              anyApi[route]
            ).join(", ")}`,
            details: {
              route,
              method,
            },
          },
        };
      }
      const endpointImpl = anyValServer?.[route]?.[method] as (
        reqData: Record<string, unknown>
      ) => Promise<ValServerGenericResult>;
      if (!endpointImpl) {
        return {
          status: 500,
          json: {
            message:
              "Missing server implementation of route with method. This might be caused by a mismatch between Val package versions.",
            details: {
              valid: {
                route: {
                  server: Object.keys(anyValServer || {}),
                  api: Object.keys(anyApi || {}),
                },
                method: {
                  server: Object.keys(anyValServer?.[route] || {}),
                  api: Object.keys(anyApi?.[route] || {}),
                },
              },
              route,
              method,
            },
          },
        };
      }
      const bodyRes = reqDefinition.body
        ? reqDefinition.body.safeParse(await req.json())
        : ({ success: true, data: {} } as z.SafeParseReturnType<
            unknown,
            unknown
          >);
      if (!bodyRes.success) {
        return zodErrorResult(bodyRes.error, "invalid body data");
      }

      const cookiesRes = reqDefinition.cookies
        ? getCookies(req, reqDefinition.cookies)
        : ({ success: true, data: {} } as z.SafeParseReturnType<
            Record<string, string>,
            Record<string, string>
          >);
      if (!cookiesRes.success) {
        return zodErrorResult(cookiesRes.error, "invalid cookies");
      }
      const actualQueryParams = groupQueryParams(
        Array.from(url.searchParams.entries())
      );
      let query = {};
      if (reqDefinition.query) {
        // This is code is particularly heavy, however
        // @see ValidQueryParamTypes in ApiRouter.ts where we explain what we want to support
        // We prioritized a declarative ApiRouter, so this code is what we ended up with for better of worse
        const queryRules: Record<string, z.ZodTypeAny> = {};
        for (const [key, zodRule] of Object.entries(reqDefinition.query)) {
          let innerType: z.ZodTypeAny = zodRule;
          let isOptional = false;
          // extract inner types:
          if (innerType instanceof z.ZodOptional) {
            isOptional = true;
            innerType = innerType.unwrap();
          }
          if (innerType instanceof z.ZodArray) {
            innerType = innerType.element;
          }
          // convert boolean to union of literals true and false so we can parse it as a string
          if (innerType instanceof z.ZodBoolean) {
            innerType = z
              .union([z.literal("true"), z.literal("false")])
              .transform((arg) => Boolean(arg));
          }
          // re-build rules:
          let arrayCompatibleRule = innerType;
          arrayCompatibleRule = z.array(innerType); // we always want to parse an array because we group the query params by into an array
          if (isOptional) {
            arrayCompatibleRule = arrayCompatibleRule.optional();
          }
          queryRules[key] = arrayCompatibleRule;
        }
        const queryRes = z.object(queryRules).safeParse(actualQueryParams);
        if (!queryRes.success) {
          return zodErrorResult(
            queryRes.error,
            `invalid query params: (${JSON.stringify(actualQueryParams)})`
          );
        }
        query = queryRes.data;
      }

      const res = await endpointImpl({
        body: bodyRes.data,
        cookies: cookiesRes.data,
        query,
        path,
      });
      const resDef = apiEndpoint.res;
      if (resDef) {
        const resRes = resDef.safeParse(res);
        if (!resRes.success) {
          return {
            status: 500,
            json: {
              message:
                "Could not validate response. This is likely a bug in the server implementation.",
              details: {
                errors: fromZodError(resRes.error).toString(),
              },
            },
          };
        }
      }
      return res;
    }

    if (path.startsWith("/static")) {
      return convert(
        await uiRequestHandler(path.slice("/static".length), url.href)
      );
    } else {
      return convert(await getValServerResponse(path, req));
    }
  };
}

function zodErrorResult(
  error: z.ZodError,
  message: string
): ValServerGenericResult {
  return {
    status: 400,
    json: {
      message: "Bad Request: " + message,
      details: {
        errors: fromZodError(error).toString(),
      },
    },
  };
}

// TODO: is this naive implementation is too naive?
function getCookies<
  Cookies extends {
    val_session?: z.ZodString | z.ZodOptional<z.ZodString>;
    val_state?: z.ZodString | z.ZodOptional<z.ZodString>;
    val_enable?: z.ZodString | z.ZodOptional<z.ZodString>;
  }
>(
  req: Request,
  cookiesDef: Cookies
): z.SafeParseReturnType<
  Record<string, string>,
  {
    [K in keyof Cookies]: Cookies[K] extends z.ZodType
      ? z.infer<Cookies[K]>
      : never;
  }
> {
  const input: Record<string, string> = {};
  const cookieParts = req.headers.get("Cookie")?.split("; ");
  for (const name of Object.keys(cookiesDef)) {
    const cookie = cookieParts?.find((cookie) => cookie.startsWith(`${name}=`));
    const value = cookie
      ? decodeURIComponent(cookie?.split("=")[1])
      : undefined;
    if (value) {
      input[name.trim()] = value;
    }
  }
  return z.object(cookiesDef).safeParse(input) as z.SafeParseReturnType<
    Record<string, string>,
    {
      [K in keyof Cookies]: Cookies[K] extends z.ZodType
        ? z.infer<Cookies[K]>
        : never;
    }
  >;
}
