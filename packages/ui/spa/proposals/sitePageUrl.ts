/**
 * Where the site serves a page, from the site's address and the page's route.
 *
 * Joined as text rather than with `new URL(route, siteUrl)`, which resolves an
 * absolute route against the ORIGIN and drops a site served under a path
 * (`https://example.com/shop` + `/about` is `/shop/about`, not `/about`).
 */
export function sitePageUrl(siteUrl: string, route: string): string {
  return `${siteUrl.replace(/\/+$/, "")}${route}`;
}

/**
 * The origin of the site's address, or null when it is not a web address.
 *
 * http(s) only. The address ends up as a frame's `src` and a link's `href`,
 * and `new URL("javascript:…")` parses -- with an origin of the STRING
 * `"null"`, so checking for a parse alone lets it through.
 */
export function siteOrigin(siteUrl: string): string | null {
  try {
    const url = new URL(siteUrl);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
