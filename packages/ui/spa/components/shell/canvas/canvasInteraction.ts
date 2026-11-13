import { VAL_CANVAS_PARAM } from "@valbuild/shared/internal";

/**
 * The page a path names, on the site the preview shows -- or why it cannot
 * be opened there: the assistant's `interact_page` with `open`.
 *
 * The frame never leaves the site: a path on another origin is refused, and
 * so is the Studio itself (a Studio in its own preview) and Val's API, which
 * is not a page. What is left is a path, query and hash on `origin`, without
 * the canvas's own parameter, which the frame adds back.
 */
export function sitePathOf(
  path: string,
  origin: string,
): { path: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    return {
      error: `${JSON.stringify(path)} is not an address. Give a path on the site, such as /about.`,
    };
  }
  if (url.origin !== origin) {
    return {
      error: `Only pages of this site can be opened in the preview, and ${JSON.stringify(path)} is on ${url.origin}. Give a path on this site, such as /about.`,
    };
  }
  const studio =
    url.pathname === "/val" ||
    url.pathname.startsWith("/val/") ||
    url.pathname === "/api/val" ||
    url.pathname.startsWith("/api/val/");
  if (studio) {
    return {
      error: `${url.pathname} is Val itself, not a page of the site: open one of the site's own pages.`,
    };
  }
  url.searchParams.delete(VAL_CANVAS_PARAM);
  return { path: `${url.pathname}${url.search}${url.hash}` };
}

/**
 * How much longer than the page's own wait the Studio waits for its answer:
 * the read after it settles, and the trip back.
 */
export const INTERACT_ANSWER_MARGIN_MS = 3000;
