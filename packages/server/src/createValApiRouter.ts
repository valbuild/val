import { promises as fs } from "fs";
import * as path from "path";
import { Internal, ValConfig, ValModules } from "@valbuild/core";
import { ValServerGenericResult } from "@valbuild/shared/internal";
import { createUIRequestHandler } from "@valbuild/ui/server";
import { ValServer, ValServerCallbacks, ValServerConfig } from "./ValServer";

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
  return new ValServer(
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

const { VAL_SESSION_COOKIE, VAL_STATE_COOKIE } = Internal;

const TREE_PATH_PREFIX = "/tree/~";
const PATCHES_PATH_PREFIX = "/patches/~";
const FILES_PATH_PREFIX = "/files";

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
    const method = req.method?.toUpperCase();

    function withTreePath(
      path: string,
      prefix: string
    ): (useTreePath: (treePath: string) => Promise<Res>) => Promise<Res> {
      return async (useTreePath) => {
        const pathIndex = path.indexOf("~");
        if (path.startsWith(prefix) && pathIndex !== -1) {
          return useTreePath(path.slice(pathIndex + 1));
        } else {
          if (prefix.indexOf("/~") === -1) {
            return convert({
              status: 500,
              json: {
                message: `Route is incorrectly formed: ${prefix}!`,
              },
            });
          }
          return convert({
            status: 404,
            json: {
              message: `Malformed ${prefix} path! Expected: '${prefix}'`,
            },
          });
        }
      };
    }

    const path = url.pathname.slice(route.length);
    if (path.startsWith("/static")) {
      return convert(
        await uiRequestHandler(path.slice("/static".length), url.href)
      );
    } else if (path === "/session") {
      return convert(
        await valServer.session(getCookies(req, [VAL_SESSION_COOKIE]))
      );
    } else if (path === "/authorize") {
      return convert(
        await valServer.authorize({
          redirect_to: url.searchParams.get("redirect_to") || undefined,
        })
      );
    } else if (path === "/callback") {
      return convert(
        await valServer.callback(
          {
            code: url.searchParams.get("code") || undefined,
            state: url.searchParams.get("state") || undefined,
          },
          getCookies(req, [VAL_STATE_COOKIE])
        )
      );
    } else if (path === "/logout") {
      return convert(await valServer.logout());
    } else if (path === "/enable") {
      return convert(
        await valServer.enable({
          redirect_to: url.searchParams.get("redirect_to") || undefined,
        })
      );
    } else if (path === "/disable") {
      return convert(
        await valServer.disable({
          redirect_to: url.searchParams.get("redirect_to") || undefined,
        })
      );
    } else if (method === "POST" && path === "/save") {
      const body = (await req.json()) as unknown;
      return convert(
        await valServer.postSave(body, getCookies(req, [VAL_SESSION_COOKIE]))
      );
      // } else if (method === "POST" && path === "/validate") {
      //   const body = (await req.json()) as unknown;
      //   return convert(
      //     await valServer.postValidate(
      //       body,
      //       getCookies(req, [VAL_SESSION_COOKIE]),
      //       requestHeaders
      //     )
      //   );
    } else if (method === "GET" && path === "/schema") {
      return convert(
        await valServer.getSchema(getCookies(req, [VAL_SESSION_COOKIE]))
      );
    } else if (method === "PUT" && path.startsWith(TREE_PATH_PREFIX)) {
      return withTreePath(
        path,
        TREE_PATH_PREFIX
      )(async (treePath) =>
        convert(
          await valServer.putTree(
            (await req.json()) as unknown,
            treePath,
            {
              patches_sha: url.searchParams.get("patches_sha") || undefined,
              validate_all: url.searchParams.get("validate_all") || undefined,
              validate_binary_files:
                url.searchParams.get("validate_binary_files") || undefined,
              validate_sources:
                url.searchParams.get("validate_sources") || undefined,
            },
            getCookies(req, [VAL_SESSION_COOKIE])
          )
        )
      );
    } else if (method === "GET" && path.startsWith(PATCHES_PATH_PREFIX)) {
      return withTreePath(
        path,
        PATCHES_PATH_PREFIX
      )(async () =>
        convert(
          await valServer.getPatches(
            {
              authors: url.searchParams.getAll("author"),
            },
            getCookies(req, [VAL_SESSION_COOKIE])
          )
        )
      );
    } else if (method === "DELETE" && path.startsWith(PATCHES_PATH_PREFIX)) {
      return withTreePath(
        path,
        PATCHES_PATH_PREFIX
      )(async () =>
        convert(
          await valServer.deletePatches(
            {
              id: url.searchParams.getAll("id"),
            },
            getCookies(req, [VAL_SESSION_COOKIE])
          )
        )
      );
    } else if (method === "GET" && path.startsWith(FILES_PATH_PREFIX)) {
      const treePath = path.slice(FILES_PATH_PREFIX.length);

      return convert(
        await valServer.getFiles(treePath, {
          patch_id: url.searchParams.get("patch_id") || undefined,
        })
      );
    } else {
      return convert({
        status: 404,
        json: {
          message: "Not Found",
          details: {
            method,
            path,
          },
        },
      });
    }
  };
}

// TODO: is this naive implementation is too naive?
function getCookies<Names extends string>(req: Request, names: Names[]) {
  return (
    req.headers
      .get("Cookie")
      ?.split("; ")
      .reduce((acc, cookie) => {
        const [name, value] = cookie.split("=");
        if ((names as string[]).includes(name.trim())) {
          acc[name.trim() as Names] = decodeURIComponent(value.trim());
        }
        return acc;
      }, {} as { [K in Names]: string }) || ({} as { [K in Names]?: string })
  );
}
