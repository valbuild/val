import type { RequestListener } from "node:http";
import express from "express";
import { createService, ServiceOptions } from "./Service";
import { createRequestHandler } from "./createRequestHandler";
import { ValServer } from "./ValServer";
import { LocalValServer, LocalValServerOptions } from "./LocalValServer";
import { ProxyValServer, ProxyValServerOptions } from "./ProxyValServer";
import { promises as fs } from "fs";
import * as path from "path";

type Opts = ValServerOverrides & ServiceOptions;

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
   * The full name of this Val project.
   *
   * Typically this is set using the VAL_NAME env var.
   *
   * @example "myorg/my-project"
   */
  valName: string;
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
}>;

async function _createRequestListener(
  route: string,
  opts: Opts
): Promise<RequestListener> {
  const serverOpts = await initHandlerOptions(route, opts);
  let valServer: ValServer;
  if (serverOpts.mode === "proxy") {
    valServer = new ProxyValServer(serverOpts);
  } else {
    valServer = new LocalValServer(serverOpts);
  }
  const reqHandler = createRequestHandler(valServer);
  return express().use(route, reqHandler);
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
    const maybeValName = opts.gitBranch || process.env.VAL_NAME;
    if (!maybeValName) {
      throw new Error("VAL_NAME env var must be set in proxy mode");
    }
    return {
      mode: "proxy",
      route,
      apiKey: maybeApiKey,
      valSecret: maybeValSecret,
      valBuildUrl,
      valContentUrl,
      gitCommit: maybeGitCommit,
      gitBranch: maybeGitBranch,
      valName: maybeValName,
      valEnableRedirectUrl:
        opts.valEnableRedirectUrl || process.env.VAL_ENABLE_REDIRECT_URL,
      valDisableRedirectUrl:
        opts.valDisableRedirectUrl || process.env.VAL_DISABLE_REDIRECT_URL,
    };
  } else {
    const cwd = process.cwd();
    const service = await createService(cwd, opts);
    return {
      mode: "local",
      service,
      git: {
        commit: process.env.VAL_GIT_COMMIT,
        branch: process.env.VAL_GIT_BRANCH || (await safeReadGitBranch(cwd)),
      },
    };
  }
}

async function safeReadGitBranch(cwd: string) {
  async function findGitHead(
    currentDir: string,
    depth: number
  ): Promise<string | undefined> {
    const gitHeadPath = path.join(currentDir, ".git", "HEAD");
    if (depth > 100) {
      console.error("Reached max depth of 100", cwd, currentDir);
      return undefined;
    }

    try {
      const headContents = await fs.readFile(gitHeadPath, "utf-8");
      const match = headContents.match(/^ref: refs\/heads\/(.+)/);
      if (match) {
        const branchName = match[1];
        return branchName;
      } else {
        return undefined;
      }
    } catch (error) {
      const parentDir = path.dirname(currentDir);

      // We've reached the root directory, return undefined
      if (parentDir === currentDir) {
        return undefined;
      }
      return findGitHead(parentDir, depth + 1);
    }
  }

  try {
    return findGitHead(cwd, 0);
  } catch (err) {
    console.error("Error while reading .git/HEAD", err);
    return undefined;
  }
}

// TODO: rename to createValApiHandlers?
export function createRequestListener(
  route: string,
  opts: Opts
): RequestListener {
  const handler = _createRequestListener(route, opts);
  return async (req, res) => {
    try {
      return (await handler)(req, res);
    } catch (e) {
      res.statusCode = 500;
      res.write(e instanceof Error ? e.message : "Unknown error");
      res.end();
      return;
    }
  };
}
