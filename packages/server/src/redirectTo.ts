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
 * anything that is neither is refused with what is accepted instead.
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
    return { ok: true, href: new URL(value, requestOrigin).href };
  }
  if (URL.canParse(value)) {
    return { ok: true, href: value };
  }
  return { ok: false, message: REDIRECT_TO_ACCEPTS };
}
