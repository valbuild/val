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
 *
 * The credential-bearing URL check at the bottom of this file lives here for the
 * same reason: it is a check on the URLs `initHandlerOptions` resolves, and its
 * only caller is that function. Leaving it in `./ValRouter` would have meant
 * importing it back from there, which is the runtime cycle the paragraph above
 * exists to avoid.
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
  warnIfInsecureUrls({ valBuildUrl, valContentUrl });
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
 * The http backend always sees the app's own API key. That is what the Studio
 * wants — there the app has already verified a session cookie and is acting on
 * the user's behalf under its own authority — and it is now the only shape:
 * every caller that reaches here has been authenticated by the app itself, so
 * there is no request left on which the app is a pipe rather than an authority.
 *
 * This took a parameter for the other case: a caller acting for a user it had
 * *not* authenticated passed that user's personal access token, and the backend
 * decided what the caller could do. `ValOpsHttp` still accepts such a token —
 * the CLI's `debug` command uses the developer's own from `val login` — but no
 * server request builds one any more, because a request the app cannot
 * authenticate is now refused instead of relayed.
 *
 * What has not changed is why the API key must never stand in for a credential
 * that was merely *absent*: it works, and it works for every project the key
 * can reach, including the ones the caller cannot. Callers are refused for a
 * missing credential well before this point.
 */
export function createValOps(
  valModules: ValModules,
  options: ValServerConfig,
): ValOpsFS | ValOpsHttp {
  if (options.mode === "fs") {
    // No credential in fs mode: this reads and writes the developer's own
    // working tree, and there is no backend to authenticate to. A credential
    // that arrives for such a project is not ignored quietly — the caller is
    // told, by `createValTools` when the project is configured for oauth and by
    // `initValMcp` when it is not, since with no issuer there is no verified
    // credential left for the registry to see.
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

/**
 * Hosts we send credentials to, and what each one puts at risk. They differ:
 * only `valBuildUrl` hands back the app token that becomes the session cookie,
 * so a single shared sentence would overstate one and understate the other.
 */
type CredentialBearingUrl = "valBuildUrl" | "valContentUrl";
const CREDENTIAL_BEARING_URLS: CredentialBearingUrl[] = [
  "valBuildUrl",
  "valContentUrl",
];
const WHAT_IS_AT_RISK: Record<CredentialBearingUrl, string> = {
  valBuildUrl:
    "Val's api key is sent to this host, and the token it returns is what this server signs into the session cookie, " +
    "so both can be read - and the token replaced - by anyone on the network path.",
  valContentUrl:
    "Val's api key, or the caller's personal access token, is sent to this host, " +
    "so it can be read by anyone on the network path.",
};

// NOTE: `URL.hostname` keeps the brackets on an IPv6 literal, so this is
// "[::1]" and not "::1" - and `http://[0:0:0:0:0:0:0:1]` normalises to the
// same short form before it gets here. Dropping the brackets looks like a
// tidy-up and silently stops matching IPv6 loopback.
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

/**
 * The URL as it is safe to print. `http://user:pass@host` is a legal override,
 * and a warning about credential exposure that puts the password in the log
 * would be the very thing it is warning about.
 */
function forLog(parsed: URL): string {
  if (!parsed.username && !parsed.password) {
    return parsed.href;
  }
  const redacted = new URL(parsed.href);
  redacted.username = "";
  redacted.password = "";
  return `${redacted.href} (credentials redacted)`;
}

/**
 * Returns a warning if `url` would send credentials somewhere they can be read
 * off the wire, or null if it is fine.
 *
 * Both URLs default to https, but each is overridable - `opts.valBuildUrl` /
 * `VAL_BUILD_URL`, `opts.valContentUrl` / `VAL_CONTENT_URL` - and neither
 * override has ever been scheme-checked. Point one at a plain http host and the
 * api key goes out in clear text, and whatever comes back is whatever the
 * network says: for `valBuildUrl` that includes the app token this server
 * re-signs into the session cookie.
 *
 * Loopback over http is exempt: that is a val.build running on the developer's
 * own machine, and there is no network to be on the wrong side of.
 *
 * This warns rather than throws. Both overrides are set by the operator, not by
 * an attacker, so this is a misconfiguration to surface - not untrusted input to
 * reject - and refusing to boot would break anyone deliberately pointing at an
 * internal http host today.
 */
export function insecureUrlWarning(
  name: CredentialBearingUrl,
  url: string,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // NOTE: the URL is not echoed here. It did not parse, so there is nothing
    // to redact with, and an unparseable string can still hold a password.
    return `Val: ${name} is not a valid URL.`;
  }
  if (parsed.protocol === "https:") {
    return null;
  }
  if (
    parsed.protocol === "http:" &&
    (LOOPBACK_HOSTNAMES.includes(parsed.hostname) ||
      parsed.hostname.endsWith(".localhost"))
  ) {
    return null;
  }
  return (
    `Val: ${name} is set to ${forLog(parsed)}, which is not https. ` +
    `${WHAT_IS_AT_RISK[name]} ` +
    `Use https, or a loopback address for local development.`
  );
}

function warnIfInsecureUrls(urls: Record<CredentialBearingUrl, string>): void {
  for (const name of CREDENTIAL_BEARING_URLS) {
    const warning = insecureUrlWarning(name, urls[name]);
    if (warning) {
      console.warn(warning);
    }
  }
}
