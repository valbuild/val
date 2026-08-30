import { DEFAULT_CONTENT_HOST, ValConfig, ValModules } from "@valbuild/core";
import type { ValServerConfig } from "./ValServer";
import type { ValApiOptions } from "./ValRouter";
import { ValOpsFS } from "./ValOpsFS";
import { ValOpsHttp } from "./ValOpsHttp";

/**
 * Resolving how Val is configured, and building the data layer from it.
 *
 * Both live here rather than inside `createValApiRouter` because the MCP tool
 * registry needs exactly the same answers: which mode we are in, which
 * credential to use, and which `ValOps` implementation that implies. Two copies
 * of this would drift, and the failure would be quiet — a registry that decides
 * it is in fs mode while the Studio decides it is in proxy mode reads different
 * content from the same project.
 *
 * The type-only import from `./ValRouter` is deliberate: it keeps `ValApiOptions`
 * where its documentation lives without creating a runtime cycle.
 */

export const DEFAULT_VAL_BUILD_URL = "https://admin.val.build";

/**
 * Resolve options plus environment into a concrete {@link ValServerConfig}.
 *
 * Moved verbatim out of `createValApiRouter`; the precedence rules are load
 * bearing, so this is the one place they are written down. Note that "proxy"
 * mode is inferred when `VAL_API_KEY` or `VAL_SECRET` is present and no mode was
 * given, which is why a project can be pushed into proxy mode by setting an env
 * var alone.
 */
export async function initHandlerOptions(
  route: string,
  opts: ValApiOptions,
  config: ValConfig,
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
    opts.valBuildUrl || process.env.VAL_BUILD_URL || DEFAULT_VAL_BUILD_URL;
  const valContentUrl =
    opts.valContentUrl || process.env.VAL_CONTENT_URL || DEFAULT_CONTENT_HOST;
  if (isProxyMode) {
    if (!maybeApiKey || !maybeValSecret) {
      throw new Error(
        "VAL_API_KEY and VAL_SECRET env vars must both be set in proxy mode",
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
    if (!maybeValProject) {
      throw new Error(
        "Proxy mode does not work unless the 'project' option in val.config is defined or the VAL_PROJECT env var is set.",
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
      config,
    };
  } else {
    const cwd = process.cwd();
    const valBuildUrl =
      opts.valBuildUrl || process.env.VAL_BUILD_URL || DEFAULT_VAL_BUILD_URL;
    return {
      mode: "fs",
      cwd,
      route,
      valDisableRedirectUrl,
      valEnableRedirectUrl,
      valBuildUrl,
      valContentUrl,
      apiKey: maybeApiKey,
      valSecret: maybeValSecret,
      project: maybeValProject,
      config,
    };
  }
}

/**
 * Build the data layer a {@link ValServerConfig} calls for.
 *
 * The `apiKey` handed to `ValOpsHttp` here is the app's own credential. A caller
 * that needs to act as a specific *user* — the MCP registry, for instance —
 * passes that user's personal access token per request instead, rather than
 * constructing a second instance around it. See `docs/plans/mcp.md` D.2.
 */
export function createValOps(
  valModules: ValModules,
  options: ValServerConfig,
): ValOpsFS | ValOpsHttp {
  if (options.mode === "fs") {
    return new ValOpsFS(options.valContentUrl, options.cwd, valModules, {
      formatter: options.formatter,
      config: options.config,
    });
  }
  if (options.mode === "http") {
    return new ValOpsHttp(
      options.valContentUrl,
      options.project,
      options.commit,
      options.branch,
      { apiKey: options.apiKey },
      valModules,
      {
        formatter: options.formatter,
        root: options.root,
        config: options.config,
      },
    );
  }
  throw new Error(
    // The union is exhausted above; this catches a config that came from
    // somewhere untyped.
    "Invalid mode: " + (options as { mode?: unknown })?.mode,
  );
}
