/**
 * Forwarding for `/admin/proxy/*`: Val Build's Studio API, `/v1/studio/*` on
 * the content server, called on the editor's behalf with the token from their
 * session.
 *
 * The web components the Studio mounts from content.val.build cannot call Val
 * Build themselves. The editor's credential is in this app's httpOnly
 * `val_session` cookie, and a cookie of admin.val.build's own would be
 * third-party on this page, which Safari and Firefox block. So they call this
 * app, and this is where the token is attached.
 *
 * It is a pipe for the path, the query and a JSON body, so a new component or
 * endpoint needs no Val release. It is NOT a pipe for where the request goes:
 * the URL is built from `contentUrl` (the server's `valContentUrl`) and must
 * still be under `/v1/studio/` after the URL parser has resolved `..`,
 * `%2e%2e` and backslashes. The editor's token can reach the endpoints written
 * for the Studio and nothing else on Val Build.
 */

export const STUDIO_API_PREFIX = "/v1/studio/";

const DEFAULT_TIMEOUT_MS = 10_000;

export type AdminProxyStatus = 200 | 400 | 401 | 403 | 404 | 500;

export type AdminProxyResult = { status: AdminProxyStatus; json: unknown };

export type ValBuildCredential = { bearer: string } | { pat: string };

export type AdminProxyRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Everything after `/admin/proxy`, starting with `/`. */
  path: string;
  /** `?a=1`, or `""`. */
  rawQuery: string;
  body: unknown;
  /**
   * Who the request is for: a deployed Studio's session token, or the
   * `val login` token of a developer running the Studio locally.
   */
  credential: ValBuildCredential;
  /** The content server, which serves the Studio API: `valContentUrl`. */
  contentUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function forwardToStudioApi({
  method,
  path,
  rawQuery,
  body,
  credential,
  contentUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: AdminProxyRequest): Promise<AdminProxyResult> {
  const url = studioApiUrl(contentUrl, path, rawQuery);
  if (url === null) {
    return {
      status: 404,
      json: { code: "not-found", message: "No such Val Build endpoint." },
    };
  }
  // Every method the route accepts may carry a JSON body: a DELETE that
  // names what it removes in its body is as valid as a PUT.
  const sendsBody = method !== "GET" && body !== undefined;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        // `x-val-pat` is the header the rest of Val Build reads a PAT from.
        ...("pat" in credential
          ? { "x-val-pat": credential.pat }
          : { authorization: `Bearer ${credential.bearer}` }),
        accept: "application/json",
        ...(sendsBody ? { "content-type": "application/json" } : {}),
      },
      body: sendsBody ? JSON.stringify(body) : undefined,
      // Never follow a redirect with the token attached.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return {
      status: 500,
      json: { code: "unreachable", message: "Could not reach Val Build." },
    };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = {
      code: "bad-gateway",
      message: `Val Build answered ${response.status} without JSON.`,
    };
  }
  return { status: mapStatus(response.status), json };
}

/**
 * `{contentUrl}/v1/studio{path}{rawQuery}`, or null when the result is not
 * under that prefix on that origin — the check that keeps the proxy from being
 * pointed anywhere else with the editor's token.
 */
export function studioApiUrl(
  contentUrl: string,
  path: string,
  rawQuery: string,
): string | null {
  if (!path.startsWith("/") || (rawQuery !== "" && !rawQuery.startsWith("?"))) {
    return null;
  }
  let base: URL;
  let url: URL;
  try {
    base = new URL(contentUrl);
    url = new URL(`${STUDIO_API_PREFIX}${path.slice(1)}${rawQuery}`, base);
  } catch {
    return null;
  }
  if (
    url.origin !== base.origin ||
    !url.pathname.startsWith(STUDIO_API_PREFIX)
  ) {
    return null;
  }
  return url.toString();
}

/**
 * Onto the statuses this server speaks. The JSON is passed through untouched,
 * so a `code` from Val Build still says what happened.
 */
function mapStatus(status: number): AdminProxyStatus {
  if (status >= 200 && status < 300) {
    return 200;
  }
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return status;
  }
  if (status >= 400 && status < 500) {
    return 400;
  }
  return 500;
}
