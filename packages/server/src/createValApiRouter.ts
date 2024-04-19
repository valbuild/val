import { createService, ServiceOptions } from "./Service";
import { IValServer, ValServerCallbacks } from "./ValServer";
import { LocalValServer, LocalValServerOptions } from "./LocalValServer";
import { ProxyValServer, ProxyValServerOptions } from "./ProxyValServer";
import { promises as fs } from "fs";
import * as path from "path";
import { Internal, ValConfig } from "@valbuild/core";
import { ValServerGenericResult } from "@valbuild/shared/internal";
import { createUIRequestHandler } from "@valbuild/ui/server";

export type ValApiOptions = ValServerOverrides & ServiceOptions & ValConfig;

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
   * The cloud name of this Val project.
   *
   * @example "myorg/my-project"
   */
  remote: string;
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
  route: string,
  opts: ValApiOptions,
  callbacks: ValServerCallbacks
): Promise<IValServer> {
  const serverOpts = await initHandlerOptions(route, opts);
  if (serverOpts.mode === "proxy") {
    const projectRoot = process.cwd(); //[process.cwd(), opts.root || ""]      .filter((seg) => seg)      .join("/");
    return new ProxyValServer(projectRoot, serverOpts, opts, callbacks);
  } else {
    return new LocalValServer(serverOpts, callbacks);
  }
}

type ValServerOptions =
  | ({ mode: "proxy" } & ProxyValServerOptions)
  | ({ mode: "local" } & LocalValServerOptions);
async function initHandlerOptions(
  route: string,
  opts: ValServerOverrides & ServiceOptions
): Promise<ValServerOptions> {
  const maybeApiKey = opts.apiKey || process.env.VAL_API_KEY;
  const maybeValSecret = opts.valSecret || process.env.VAL_SECRET;
  const isProxyMode =
    opts.mode === "proxy" ||
    (opts.mode === undefined && (maybeApiKey || maybeValSecret));

  if (isProxyMode) {
    const valBuildUrl =
      opts.valBuildUrl || process.env.VAL_BUILD_URL || "https://app.val.build";
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
    const maybeValRemote = opts.remote || process.env.VAL_REMOTE;
    if (!maybeValRemote) {
      throw new Error(
        "Proxy mode does not work unless the 'remote' option in val.config is defined or the VAL_REMOTE env var is set."
      );
    }

    return {
      mode: "proxy",
      route,
      apiKey: maybeApiKey,
      valSecret: maybeValSecret,
      valBuildUrl,
      valContentUrl,
      git: {
        commit: maybeGitCommit,
        branch: maybeGitBranch,
      },
      remote: maybeValRemote,
      valEnableRedirectUrl:
        opts.valEnableRedirectUrl || process.env.VAL_ENABLE_REDIRECT_URL,
      valDisableRedirectUrl:
        opts.valDisableRedirectUrl || process.env.VAL_DISABLE_REDIRECT_URL,
    };
  } else {
    const cwd = process.cwd();
    const service = await createService(cwd, opts);
    const git = await safeReadGit(cwd);
    return {
      mode: "local",
      service,
      valEnableRedirectUrl:
        opts.valEnableRedirectUrl || process.env.VAL_ENABLE_REDIRECT_URL,
      valDisableRedirectUrl:
        opts.valDisableRedirectUrl || process.env.VAL_DISABLE_REDIRECT_URL,
      git: {
        commit: process.env.VAL_GIT_COMMIT || git.commit,
        branch: process.env.VAL_GIT_BRANCH || git.branch,
      },
    };
  }
}

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
  valServerPromise: Promise<IValServer>,
  convert: (valServerRes: ValServerGenericResult) => Res
): (req: Request) => Promise<Res> {
  const uiRequestHandler = createUIRequestHandler();
  return async (req): Promise<Res> => {
    const valServer = await valServerPromise;
    const requestHeaders = {
      host: req.headers.get("host"),
      "x-forwarded-proto": req.headers.get("x-forwarded-proto"),
    };
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
    } else if (method === "POST" && path === "/commit") {
      const body = (await req.json()) as unknown;
      return convert(
        await valServer.postCommit(
          body,
          getCookies(req, [VAL_SESSION_COOKIE]),
          requestHeaders
        )
      );
    } else if (method === "POST" && path === "/validate") {
      const body = (await req.json()) as unknown;
      return convert(
        await valServer.postValidate(
          body,
          getCookies(req, [VAL_SESSION_COOKIE]),
          requestHeaders
        )
      );
    } else if (method === "GET" && path.startsWith(TREE_PATH_PREFIX)) {
      return withTreePath(
        path,
        TREE_PATH_PREFIX
      )(async (treePath) =>
        convert(
          await valServer.getTree(
            treePath,
            {
              patch: url.searchParams.get("patch") || undefined,
              schema: url.searchParams.get("schema") || undefined,
              source: url.searchParams.get("source") || undefined,
              validate: url.searchParams.get("validate") || undefined,
            },
            getCookies(req, [VAL_SESSION_COOKIE]),
            requestHeaders
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
              id: url.searchParams.getAll("id"),
            },
            getCookies(req, [VAL_SESSION_COOKIE])
          )
        )
      );
    } else if (method === "POST" && path.startsWith(PATCHES_PATH_PREFIX)) {
      const body = (await req.json()) as unknown;
      return withTreePath(
        path,
        PATCHES_PATH_PREFIX
      )(async () =>
        convert(
          await valServer.postPatches(
            body,
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
    } else if (path.startsWith(FILES_PATH_PREFIX)) {
      const treePath = path.slice(FILES_PATH_PREFIX.length);
      return convert(
        await valServer.getFiles(
          treePath,
          {
            sha256: url.searchParams.get("sha256") || undefined,
          },
          getCookies(req, [VAL_SESSION_COOKIE]),
          requestHeaders
        )
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
