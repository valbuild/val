/**
 * What `redirect_to` may be on Val's routes (`/enable`, `/disable`,
 * `/authorize`, `/draft/enable`, ...): an absolute URL, or a path on the site
 * that was asked, which is made absolute against the request's own origin.
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
  "redirect_to must be an absolute URL (https://example.com/page) or a path on this site starting with / (/page).";

export function resolveRedirectTo(
  value: string,
  requestOrigin: string,
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
  if (parsed(value) !== null) {
    return { ok: true, href: value };
  }
  return { ok: false, message: REDIRECT_TO_ACCEPTS };
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
