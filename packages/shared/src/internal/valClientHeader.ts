/**
 * Which Val package, at which version, sent a request to Val Build.
 *
 * Sent on every request a Val package makes to Val's own services from a
 * server or a CLI -- the content host, `/api/login`, the analytics ingest --
 * so Val Build can tell which versions are still out there and which old
 * endpoints they still call. Without it an endpoint can never be retired with
 * any confidence: a request from a site nobody has upgraded in a year looks
 * exactly like one from yesterday's release.
 *
 * The value is a product token, `@valbuild/server@0.152.0`: the package whose
 * code built the request, because that is what decides which endpoints are
 * called. Not the framework binding or the app: those do not choose URLs.
 *
 * NOT sent from the browser. A custom header on a cross-origin request makes
 * the browser send a CORS preflight, and a host that does not list the header
 * in `Access-Control-Allow-Headers` refuses the request outright -- so adding
 * it there is a change to every such host first.
 *
 * It identifies the code, not the caller: anyone can send any value, so it is
 * for counting, never for deciding what a request may do.
 */
export const VAL_CLIENT_HEADER = "val-client";

/** Packages that send {@link VAL_CLIENT_HEADER}. */
export type ValClientPackage = "@valbuild/server" | "@valbuild/cli";

/**
 * `{ "val-client": "@valbuild/server@0.152.0", "x-val-client": …,
 * "val-version": "2026-11-02" }`, to spread into a request's headers.
 *
 * A version that could not be read is sent as `unknown` rather than leaving
 * the header out: "a server too broken to know its version" is still a thing
 * worth counting, and it is not the same as "a version older than the header".
 */
export function valClientHeaders(
  pkg: ValClientPackage,
  version: string | null | undefined,
): Record<string, string> {
  return {
    ...valHeaders("client", `${pkg}@${version || "unknown"}`),
    [VAL_API_VERSION_HEADER]: VAL_API_VERSION,
  };
}

/**
 * The version of Val Build's content API these packages are written for: the
 * date its contract froze (`docs/api-contract.md` in valbuild/home). Sent as
 * `val-version` on every request, beside {@link VAL_CLIENT_HEADER}.
 *
 * A server that does not serve it answers 400 `unsupported-version`, saying
 * which side has to be updated, rather than answering in a shape this code
 * does not read. A server from before the contract ignores it.
 */
export const VAL_API_VERSION = "2026-11-02";
export const VAL_API_VERSION_HEADER = "val-version";

/**
 * The headers Val sends to Val Build, by their name without a prefix. The
 * contract names them `val-*`; the `x-val-*` they replace is sent beside them
 * until no content host still reads only that (twelve months after the
 * release that started sending both), so a package and a server can be
 * updated in either order.
 */
export type ValHeaderName =
  | "client"
  | "pat"
  | "profile-id"
  | "auth-nonce"
  | "upload-token"
  | "project"
  | "visitor-user-agent"
  | "visitor-country";

/** `{ "val-<name>": value, "x-val-<name>": value }`. */
export function valHeaders(
  name: ValHeaderName,
  value: string,
): Record<string, string> {
  return { [`val-${name}`]: value, [`x-val-${name}`]: value };
}

/** How a request to Val Build says who it is from. */
export type ValCredential =
  /** A person's token from `val login`. */
  | { pat: string }
  /** The project's API key, held by the app's server. */
  | { apiKey: string }
  /** Any other bearer: a Studio token, a project token. */
  | { bearer: string };

/**
 * The headers that carry `credential`.
 *
 * A personal access token goes as the bearer, which is where the contract
 * puts every credential (its `val_pat_` prefix says what it is), and in
 * `val-pat` / `x-val-pat` too, where a content host from before the contract
 * reads it. Such a host tries a bearer it does not recognise as the API key,
 * a project token or an account token and moves on to the header, so sending
 * both is safe in either order of deploys.
 */
export function valCredentialHeaders(
  credential: ValCredential,
): Record<string, string> {
  if ("pat" in credential)
    return {
      Authorization: `Bearer ${credential.pat}`,
      ...valHeaders("pat", credential.pat),
    };
  if ("apiKey" in credential)
    return { Authorization: `Bearer ${credential.apiKey}` };
  return { Authorization: `Bearer ${credential.bearer}` };
}
