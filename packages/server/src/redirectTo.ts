/**
 * What `redirect_to` may be on Val's routes (`/enable`, `/disable`,
 * `/authorize`, `/draft/enable`, ...): a path on the site that was asked,
 * which is made absolute against the request's own origin, or an absolute
 * URL on that same site.
 *
 * A path used to go through as it was, and two things downstream need an
 * absolute URL: `/authorize` reads the origin off it to build the callback,
 * and Next's `NextResponse.redirect` refuses anything else. Both threw, so
 * `/api/val/enable?redirect_to=/` answered 500 in a Next app.
 *
 * `//host/path` is a URL on another host, not a path on this one, and
 * anything that is neither is refused with what is accepted instead. An
 * empty value is not resolved at all: the router leaves it to the route, as
 * it always was (`/logout` reads it as absent).
 */
export type ResolvedRedirect =
  | { ok: true; href: string }
  | { ok: false; message: string };

export const REDIRECT_TO_ACCEPTS =
  "redirect_to must be a path on this site starting with / (/page), or an absolute URL on this site (https://this-site.example/page).";

/**
 * `siteHosts` are the other names the request knows this site by (`Host`,
 * `X-Forwarded-Host`), for a server behind a proxy whose own URL is internal.
 */
export function resolveRedirectTo(
  value: string,
  requestOrigin: string,
  siteHosts: readonly (string | null | undefined)[] = [],
): ResolvedRedirect {
  if (value.startsWith("/") && !value.startsWith("//")) {
    // A path stays on this origin. `/\host/x` also starts with one slash,
    // and a URL parser reads the backslash as a second one: another host,
    // not a path here.
    const resolved = parsed(value, requestOrigin);
    return resolved !== null &&
      resolved.origin === new URL(requestOrigin).origin
      ? { ok: true, href: resolved.href }
      : { ok: false, message: REDIRECT_TO_ACCEPTS };
  }
  // An absolute URL, on this site only. Any URL used to pass, which made
  // `/logout` and `/enable` redirect wherever a link said, and `/authorize`
  // send the sign-in's code to that host: it reads the callback's origin off
  // this. http(s) only: `javascript:` parses as a URL too.
  const url = parsed(value);
  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:")) {
    return { ok: false, message: REDIRECT_TO_ACCEPTS };
  }
  const hosts = [new URL(requestOrigin).host, ...siteHosts]
    .filter((host): host is string => typeof host === "string" && host !== "")
    .map((host) => host.toLowerCase());
  return hosts.includes(url.host.toLowerCase())
    ? { ok: true, href: value }
    : { ok: false, message: REDIRECT_TO_ACCEPTS };
}

/**
 * `value` as a URL, or null. Not `URL.canParse`: this runs in the browser
 * too (demo mode), where it is missing before Safari 17 and Chrome 120.
 */
function parsed(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}
