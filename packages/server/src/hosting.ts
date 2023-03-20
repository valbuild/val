import type { RequestListener } from "node:http";
import express from "express";
import { createService, ServiceOptions } from "./Service";
import { createRequestHandler } from "./createRequestHandler";
import { ValServer } from "./ValServer";
import { LocalValServer, LocalValServerOptions } from "./LocalValServer";
import { ProxyValServer, ProxyValServerOptions } from "./ProxyValServer";

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
   * Override the Val project.
   *
   * Required if mode is "proxy".
   *
   * This is the full name of the project found in the https://app.val.build/projects page.
   *
   * Typically this is set using VAL_PROJECT env var.
   *
   * @example "my-org/my-project"
   */
  valProject: string;
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
    const maybeGitCommit = opts.gitCommit || process.env.VAL_GIT_COMMIT;
    if (!maybeGitCommit) {
      throw new Error("VAL_GIT_COMMIT env var must be set in proxy mode");
    }
    const maybeGitBranch = opts.gitBranch || process.env.VAL_GIT_BRANCH;
    if (!maybeGitBranch) {
      throw new Error("VAL_GIT_BRANCH env var must be set in proxy mode");
    }
    const maybeValProject = opts.valProject || process.env.VAL_PROJECT;
    if (!maybeValProject) {
      throw new Error("VAL_PROJECT env var must be set in proxy mode");
    }
    return {
      mode: "proxy",
      route,
      apiKey: maybeApiKey,
      valSecret: maybeValSecret,
      valBuildUrl,
      gitCommit: maybeGitCommit,
      gitBranch: maybeGitBranch,
      valProject: maybeValProject,
    };
  } else {
    const service = await createService(process.cwd(), opts);
    return {
      mode: "local",
      service,
    };
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
