import type { ValServerGenericResult } from "@valbuild/shared/internal";

/**
 * Which requests Val's API answers in fs mode, where there is no session.
 *
 * fs mode reads and writes a working tree and asks nobody who they are: it is
 * a developer's own machine. That holds only while the request really comes
 * from that developer's Studio, and three kinds do not:
 *
 * - **A deployed site.** fs is the mode an app falls into when it has no
 *   `VAL_API_KEY` and `VAL_SECRET`, so a site deployed without them served
 *   this API, unauthenticated, to the internet.
 * - **Another site's page**, in the developer's browser. A `text/plain` POST
 *   needs no preflight, and the router reads its body as JSON, so any page
 *   open in another tab could write to the working tree.
 * - **A name that resolves to 127.0.0.1** (DNS rebinding), which makes such a
 *   page same-origin with the dev server as far as the browser can tell.
 *
 * The MCP endpoint has refused all three since it was written
 * (`refuseUnsafeRequest` in `@valbuild/mcp`); this is the same rule for the
 * API the Studio uses. Nothing here needs Node: `ValRouterCore` runs in a
 * browser tab too, where no server is registered and nothing is refused.
 */
export type RequestGuard = {
  mode: "fs" | "http" | "memory";
  /** `NODE_ENV` is `production`: a built app, not a dev server. */
  production: boolean;
  /** Host names a dev server answers on besides localhost: `VAL_ALLOWED_HOSTS`. */
  allowedHosts: readonly string[];
};

const guards = new WeakMap<object, RequestGuard>();

/** Say how `server`'s requests are to be checked. Without it, none are. */
export function setRequestGuard(server: object, guard: RequestGuard): void {
  guards.set(server, guard);
}

/** `VAL_ALLOWED_HOSTS`: comma separated host names, without a port. */
export function parseAllowedHosts(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== "");
}

/** The refusal, or `null` when the request may go on to its route. */
export function refuseUnsafeRequest(
  server: object,
  req: Request,
  apiPath: string,
): ValServerGenericResult | null {
  const guard = guards.get(server);
  if (guard === undefined || guard.mode !== "fs") {
    return null;
  }
  // Beacons are not refused: in fs mode one is checked and dropped, nothing
  // is written or forwarded, and a deployed site with analytics on would fill
  // every visitor's console with errors.
  if (apiPath === "/analytics") {
    return null;
  }
  if (guard.production) {
    return refusal(
      "Val is not set up for a deployed site here: without VAL_API_KEY and VAL_SECRET it runs in local filesystem mode, which has no sign-in and is only served by a development server. Set both (and VAL_PROJECT) on this deployment to use Val on it.",
    );
  }

  const host = hostOf(req);
  const forwardedHost = firstOf(req.headers.get("x-forwarded-host"));
  const origin = req.headers.get("origin");
  if (origin !== null) {
    // `null` is the opaque origin (a sandboxed frame, a `file:` page). It
    // cannot be compared with anything, so it is refused.
    const originHost = origin === "null" ? null : hostOfUrl(origin);
    if (
      originHost === null ||
      (originHost !== host && originHost !== forwardedHost)
    ) {
      return refusal(
        `Val refused a request from another site (${origin}). In local filesystem mode the API only answers the Studio on its own address.`,
      );
    }
  }
  // A request with no `Origin` can still come from another site: an `<img>`,
  // a script. Following a link here is not refused: sign-in comes back as one.
  if (
    req.headers.get("sec-fetch-site") === "cross-site" &&
    req.headers.get("sec-fetch-mode") !== "navigate"
  ) {
    return refusal(
      "Val refused a request from another site. In local filesystem mode the API only answers the Studio on its own address.",
    );
  }

  const hostname = host === null ? null : hostnameOf(host);
  if (hostname === null || !isLocalName(hostname, guard.allowedHosts)) {
    return refusal(
      `Val refused a request addressed to ${host ?? "an unknown host"}. In local filesystem mode the API answers on localhost and on IP addresses, because any other name can be made to point at this machine by the site that owns it. If this is the address you develop on, add its host name to the VAL_ALLOWED_HOSTS environment variable (comma separated) and restart the dev server.`,
    );
  }
  return null;
}

function refusal(message: string): ValServerGenericResult {
  return { status: 403, json: { message } };
}

function firstOf(header: string | null): string | null {
  const first = header?.split(",")[0]?.trim().toLowerCase();
  return first ? first : null;
}

function hostOf(req: Request): string | null {
  const header = firstOf(req.headers.get("host"));
  if (header !== null) {
    return header;
  }
  // No Host header: the URL the framework built the request from.
  return hostOfUrl(req.url);
}

function hostOfUrl(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** A host without its port. An IPv6 literal keeps its brackets. */
function hostnameOf(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

/**
 * localhost, an IP address, or a name the developer listed.
 *
 * An IP address is allowed because it cannot be rebound: a page that reaches
 * this server by address is on another origin, and the `Origin` check above
 * has already refused it. A phone on the same network uses one.
 */
function isLocalName(
  hostname: string,
  allowedHosts: readonly string[],
): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    (hostname.startsWith("[") && hostname.endsWith("]")) ||
    allowedHosts.includes(hostname)
  );
}
