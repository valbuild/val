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
export const VAL_CLIENT_HEADER = "x-val-client";

/** Packages that send {@link VAL_CLIENT_HEADER}. */
export type ValClientPackage = "@valbuild/server" | "@valbuild/cli";

/**
 * `{ "x-val-client": "@valbuild/server@0.152.0" }`, to spread into a
 * request's headers.
 *
 * A version that could not be read is sent as `unknown` rather than leaving
 * the header out: "a server too broken to know its version" is still a thing
 * worth counting, and it is not the same as "a version older than the header".
 */
export function valClientHeaders(
  pkg: ValClientPackage,
  version: string | null | undefined,
): { [VAL_CLIENT_HEADER]: string } {
  return { [VAL_CLIENT_HEADER]: `${pkg}@${version || "unknown"}` };
}
