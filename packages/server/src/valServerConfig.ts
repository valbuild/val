import { DEFAULT_CONTENT_HOST, ValConfig, ValModules } from "@valbuild/core";
import type { ValServerConfig } from "./ValServer";
import type { ValApiOptions } from "./ValRouter";
import { ValOpsFS } from "./ValOpsFS";
import { ValOpsHttp } from "./ValOpsHttp";
import { ValOpsMemory } from "./ValOpsMemory";
import {
  getPersonalAccessTokenPath,
  parsePersonalAccessTokenFile,
} from "./personalAccessTokens";

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
 * The value of `VAL_ENV` that means "this is the Val app".
 *
 * The Val app builds a project in a browser and runs it in a Worker isolate.
 * There is no disk there and there never will be, so `fs` mode is never the
 * right fall-through -- and the content is Val's own, reached over HTTP at a
 * commit, exactly as it is for any other deployed app. So this names `http`.
 *
 * What makes the app unusual is not where its content comes from but what
 * publishing means: the browser rebuilds the site and the new build is served
 * immediately, instead of a host noticing a commit and redeploying. That is a
 * difference in what happens AFTER the commit, and `publishOverride` is where
 * a host says so -- not a difference in where patches, files or sources live.
 *
 * A host says WHERE it runs, which is a fact it knows. Which Val mode that
 * implies is Val's to derive, and that is the whole reason this exists next to
 * `VAL_MODE` rather than the platform naming a mode itself: one is a
 * description of an environment, the other an assertion about Val's internals,
 * and only the first stays true when the internals move. They have already
 * moved once -- this meant `memory` while the app kept its own patch store --
 * and no platform had to be changed to follow.
 */
const VAL_APP_ENV = "app";

/** Which mode the environment SAYS this is, and which variable said so. */
type NamedMode = { mode: string; from: "VAL_MODE" | "VAL_ENV" };

/**
 * `null` is "the environment did not say", which is the normal case.
 *
 * The two variables differ in what can be DONE with an answer, and the
 * difference is whether the environment holds everything the mode needs.
 * `http` does -- an api key, a secret, a project, a commit and a branch are all
 * env vars -- so `VAL_ENV=app` SELECTS it, and the checks in
 * {@link initHandlerOptions} name whichever one is missing. `memory` does not:
 * it needs the host's own source files, which nothing in an environment can
 * supply, so `VAL_MODE=memory` can only ever turn a fall-through into an error.
 */
function namedMode(): NamedMode | null {
  const declared = process.env.VAL_MODE;
  /*
   * An empty value counts as unset, which is what `VAL_MODE=` in a shell or a
   * CI settings page means. An explicit `VAL_MODE` otherwise wins over
   * `VAL_ENV`: naming a mode outright says something more specific than naming
   * an environment does, including when what it names is wrong and has to be
   * refused.
   */
  if (declared !== undefined && declared !== "") {
    return { mode: declared, from: "VAL_MODE" };
  }
  if (process.env.VAL_ENV === VAL_APP_ENV) {
    return { mode: "http", from: "VAL_ENV" };
  }
  return null;
}

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
  /*
   * A host that handed us the source has settled the question.
   *
   * First, and without consulting the environment: the other two modes are
   * inferred (an api key in the env is enough to make a project "proxy"), and
   * this one cannot be, so an env var that happens to be set must not be able
   * to take a host that supplied its own source and point it at a content
   * service instead.
   */
  if (opts.sourceFiles !== undefined) {
    const valContentUrl =
      opts.valContentUrl || process.env.VAL_CONTENT_URL || DEFAULT_CONTENT_HOST;
    const valBuildUrl =
      opts.valBuildUrl || process.env.VAL_BUILD_URL || DEFAULT_VAL_BUILD_URL;
    /*
     * The same warning the other two modes get, and for the same reason.
     *
     * Returning early here skipped it, and the early return is about MODE
     * INFERENCE -- not about which URLs are safe. This mode still sends
     * `apiKey` to `valContentUrl` for remote-file settings and uploads, so a
     * host configured with a non-loopback `http://` content URL was putting a
     * credential on the wire with none of the warning fs and http modes give
     * for exactly that.
     */
    warnIfInsecureUrls({ valBuildUrl, valContentUrl });
    return {
      mode: "memory",
      route,
      sourceFiles: opts.sourceFiles,
      patchStore: opts.patchStore,
      unsafelyAllowUnauthenticated: opts.unsafelyAllowUnauthenticated,
      valContentUrl,
      valBuildUrl,
      valEnableRedirectUrl:
        opts.valEnableRedirectUrl || process.env.VAL_ENABLE_REDIRECT_URL,
      valDisableRedirectUrl:
        opts.valDisableRedirectUrl || process.env.VAL_DISABLE_REDIRECT_URL,
      apiKey: opts.apiKey || process.env.VAL_API_KEY,
      valSecret: opts.valSecret || process.env.VAL_SECRET,
      project: opts.project || process.env.VAL_PROJECT,
      config,
    };
  }
  /*
   * The environment saying 'memory' means the host MEANT to hold the source,
   * and did not. Either variable can say it: `VAL_MODE=memory` outright, or
   * `VAL_ENV=app`, which names an environment that has no disk.
   *
   * Neither can SELECT memory mode -- nothing in the environment can supply
   * `sourceFiles`, and a mode turned on without them is a server with no
   * content in it. What they do is turn the fall-through into an error.
   *
   * Without it, a host that forgot to pass its source got `fs` mode, and `fs`
   * mode in a Worker isolate reaches for a working tree that is not there: the
   * failure is an `EPERM` on `.val/patches.lock`, several layers below the
   * mistake, naming a path rather than the decision that led to it. Every
   * environment that runs Val without a disk can set this once and get a
   * sentence instead.
   */
  const declared = namedMode();
  if (declared?.mode === "memory") {
    throw new Error(
      "VAL_MODE is 'memory', but no `sourceFiles` were given here, so there " +
        "is no source to serve. Memory mode cannot be turned on by the " +
        "environment: it needs the project's own source, and only the host " +
        "that holds it can hand it over. On TanStack Start that is the " +
        "`sourceFiles` option, passed to `initValServer` AND to " +
        "`initValContent`, which has a Val server of its own and is " +
        "configured separately. @valbuild/next has no memory mode yet, so " +
        "for a Next app this variable is set on an environment Val cannot " +
        "serve from. Unset VAL_MODE to go back to the inferred mode instead " +
        "('http' when VAL_API_KEY and VAL_SECRET are both set, 'fs' " +
        "otherwise).",
    );
  }
  /*
   * Every other value is refused rather than ignored: ignoring `VAL_MODE=memry`
   * would leave the app in `fs` mode, which is the exact failure this variable
   * exists to catch.
   *
   * `VAL_ENV` is excluded by name rather than by its value happening to pass:
   * it names 'http', which is selected below, and a reader who sees only
   * `declared !== null` here would reasonably conclude that 'http' is a
   * `VAL_MODE` value -- it is not, and the message below says so.
   */
  if (declared !== null && declared.from === "VAL_MODE") {
    throw new Error(
      `VAL_MODE is '${declared.mode}', which is not a mode Val knows. The only ` +
        "value it accepts is 'memory', which asserts that the host supplies " +
        "`sourceFiles`. 'fs' and 'http' are inferred rather than named: " +
        "'http' when VAL_API_KEY and VAL_SECRET are both set, 'fs' otherwise.",
    );
  }

  const maybeApiKey = opts.apiKey || process.env.VAL_API_KEY;
  const maybeValSecret = opts.valSecret || process.env.VAL_SECRET;
  /*
   * The app's environment selects http mode, rather than leaving it to be
   * inferred from a credential being present.
   *
   * The difference shows when something is MISSING. Inference reads an absent
   * api key as "not a proxy" and falls through to `fs`, which in an isolate
   * reaches for a working tree that is not there -- an `EPERM` on
   * `.val/patches.lock`, several layers below the mistake. Selecting the mode
   * means the checks below run instead, and each one names what it wanted.
   */
  const isAppEnv = declared?.from === "VAL_ENV";
  const isProxyMode =
    opts.mode === "proxy" ||
    isAppEnv ||
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
    /*
     * Why this app is in http mode, in the message that says what is missing.
     *
     * "must be set in proxy mode" is a fine sentence for a developer who wrote
     * `mode: "proxy"` and a poor one for an app that never mentioned a mode:
     * there, the answer to "why am I in proxy mode?" is a variable set by the
     * platform, in a file the reader of this error is not looking at.
     */
    const because = isAppEnv
      ? " (VAL_ENV is 'app', which is the Val app: its content is Val's own " +
        "and is read over HTTP at a commit, so http mode is the mode and " +
        "these are what it needs)"
      : "";
    if (!maybeApiKey || !maybeValSecret) {
      throw new Error(
        "VAL_API_KEY and VAL_SECRET env vars must both be set in proxy mode" +
          because,
      );
    }
    /*
     * A COMMIT IS NOT WHAT PUTS AN APP IN HTTP MODE. Credentials are.
     *
     * Both of these used to be required here, and the requirement was a
     * repository disguised as a configuration check: a deployment with no
     * commit to name -- one whose content service owns its content, which is
     * now the normal case -- threw at boot, or, worse, never reached this
     * branch at all and fell through to `fs` mode, looking for a working tree
     * that was not there.
     *
     * Absent is a project with no repository to mirror commits into. The
     * content service mints its own commit shas and is the store of record for
     * content, so there is nothing missing: see `git` on {@link ValApiOptions}
     * for what a commit is still FOR where there is one.
     *
     * Taken together or not at all. A commit without a branch names a point
     * with no line of work to publish to, and a branch without a commit names
     * a line with no position in it; either alone would be a half-configured
     * repository that fails later, at a publish, rather than here.
     */
    const maybeGitCommit = opts.git?.commit || process.env.VAL_GIT_COMMIT;
    const maybeGitBranch = opts.git?.branch || process.env.VAL_GIT_BRANCH;
    if (!!maybeGitCommit !== !!maybeGitBranch) {
      throw new Error(
        `Val is configured with a git ${maybeGitCommit ? "commit" : "branch"} ` +
          `but no ${maybeGitCommit ? "branch" : "commit"}. Set both (the ` +
          "`git` option, or VAL_GIT_COMMIT and VAL_GIT_BRANCH) for a project " +
          "whose content is mirrored into a repository, or neither for one " +
          "whose content service is the store of record." +
          because,
      );
    }
    if (!maybeValProject) {
      throw new Error(
        "Proxy mode does not work unless the 'project' option in val.config is defined or the VAL_PROJECT env var is set." +
          because,
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
      /*
       * Spread, so a project with no repository has no `git` key at all rather
       * than one holding undefined. `ValOpsHttp` asks `git === null` to decide
       * whether to send a branch and a commit with every request, and a key
       * that is present-but-undefined is one more thing for that check to get
       * wrong.
       */
      ...(maybeGitCommit && maybeGitBranch
        ? { git: { commit: maybeGitCommit, branch: maybeGitBranch } }
        : {}),
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
): ValOpsFS | ValOpsHttp | ValOpsMemory {
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
      options.git ?? null,
      { apiKey: options.apiKey },
      valModules,
      {
        formatter: options.formatter,
        root: options.root,
        config: options.config,
      },
    );
  }
  if (options.mode === "memory") {
    /*
     * No backend to authenticate AGAINST, which is not the same as nothing to
     * authenticate. That conflation is what made this mode serve every route to
     * anyone who could reach the port: fs mode skips auth because it is a
     * developer's own machine, and this one reuses its local-store flag while
     * running deployed. It requires a verified session unless the host says it
     * has its own boundary -- see `unsafelyAllowUnauthenticated`.
     *
     * The host still holds the source and decides what a publish means; that
     * part is `commitPrepared` on ValServerOptions.
     */
    return new ValOpsMemory(valModules, {
      formatter: options.formatter,
      config: options.config,
      sourceFiles: options.sourceFiles,
      patchStore: options.patchStore,
      unsafelyAllowUnauthenticated: options.unsafelyAllowUnauthenticated,
      // For pushing remote files at publish. A project with no `s.image()`
      // never reaches it, which is why nothing above requires it.
      contentUrl: options.valContentUrl,
    });
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

/**
 * Which credential talks to the content host about REMOTE FILES.
 *
 * A separate question from the one `createValOps` answers, and it has to be:
 * `ValOps` is authenticated per caller, but remote files are project-level —
 * looking up a project's public id and its buckets, and later pushing bytes to
 * them, is the same operation whoever asked for it.
 *
 * The rule, in order:
 *
 * 1. The app's API key, if there is one. Proxy mode always has one; fs mode has
 *    one when `VAL_API_KEY` is set.
 * 2. In fs mode, the developer's own `val login` token, read off disk. This is
 *    the same file `val validate --fix` reads, and it is why local remote
 *    uploads work with no configuration beyond having logged in.
 * 3. Nothing, which is an error rather than a fallback.
 *
 * Lives here rather than inside `createValServer` because the MCP image tool
 * needs the same answer, and this is the file that exists so that two callers
 * cannot disagree about how a project is configured. A registry that decided it
 * had no credential while the Studio in the same process had one would be a
 * genuinely confusing afternoon.
 */
export type RemoteFileAuth = { apiKey: string } | { pat: string };

export type ResolveRemoteFileAuthResult =
  | { status: "success"; auth: RemoteFileAuth }
  | {
      status: "error";
      errorCode: "project-not-configured" | "pat-error" | "api-key-missing";
      message: string;
    };

export async function resolveRemoteFileAuth(
  options: ValServerConfig,
): Promise<ResolveRemoteFileAuthResult> {
  if (options.apiKey) {
    return { status: "success", auth: { apiKey: options.apiKey } };
  }
  if (options.mode !== "fs") {
    /*
     * `api-key-missing`, and the distinction matters to whoever reads it.
     *
     * The PAT below is read from a file in the server's own working directory,
     * which only `fs` mode has. Every other mode can be authenticated one way,
     * with an api key -- so the Studio must not offer `val login` here. It did,
     * because "local" used to mean "fs" and the third mode made that false: the
     * dialog told people to run a command, in a directory, that could not have
     * helped even if they found the right one.
     *
     * `project-not-configured` was also just wrong. The project may be
     * perfectly well configured; it is the credential that is absent.
     */
    return {
      status: "error",
      errorCode: "api-key-missing",
      message:
        "Remote files need an api key here: this server cannot read a " +
        "personal access token, because that is a file in a working directory " +
        "and it has none. Set VAL_API_KEY.",
    };
  }
  // `options.cwd`, which `initHandlerOptions` sets from `process.cwd()`. The
  // token lives in the project's own `.val/pat.json`, so this is the same file
  // `val login` wrote and `val validate --fix` reads.
  const patPath = getPersonalAccessTokenPath(options.cwd);
  const fs = await import("fs");
  let patFile: string;
  try {
    patFile = await fs.promises.readFile(patPath, "utf-8");
  } catch {
    return {
      status: "error",
      errorCode: "pat-error",
      message: "Could not read personal access token file",
    };
  }
  const patRes = parsePersonalAccessTokenFile(patFile);
  if (!patRes.success) {
    return {
      status: "error",
      errorCode: "pat-error",
      message: "Could not parse personal access token file",
    };
  }
  return { status: "success", auth: { pat: patRes.data.pat } };
}
