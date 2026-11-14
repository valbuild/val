import {
  VAL_CANVAS_PARAM,
  type PageApproval,
  type PageRequest,
} from "@valbuild/shared/internal";

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

/**
 * Why the page would not do an action, in the page's words: its refusals
 * name its own elements -- their ids, names, text -- so the answer says
 * whose words they are (`PAGE_DATA_PROVENANCE`) and keeps them short.
 */
export class PageRefusedError extends Error {
  constructor(message: string) {
    super(clampPageText(message, 600));
    this.name = "PageRefusedError";
  }
}

/** Text from the page, cut to `length`. */
export function clampPageText(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** The methods a held request may be shown with: the ones that send. */
const SENDING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** At most this many requests on one card. */
const MAX_SHOWN_REQUESTS = 10;

/**
 * What the page asked the person about, checked before the Studio shows
 * any of it -- or why it cannot be shown.
 *
 * Every field came from the page, and not only from Val's code there: the
 * `interact` message is posted into the page's window, where any script of
 * the site sees it and can answer first. So nothing is taken on trust. A
 * method must be one that sends data; an address must be on this site (the
 * bridge refuses others, and anything that says otherwise is not the
 * bridge); the label is shortened and its quote marks taken out, so it can
 * be shown as one quoted piece of the page's text and nothing more.
 */
export function trustedApproval(
  approval: PageApproval,
  origin: string,
): { approval: PageApproval } | { error: string } {
  if (approval.requests.length === 0) {
    return { error: "The page asked about sending nothing: nothing was sent." };
  }
  const requests: PageRequest[] = [];
  for (const request of approval.requests.slice(0, MAX_SHOWN_REQUESTS)) {
    const method = request.method.toUpperCase();
    if (!SENDING_METHODS.has(method)) {
      return {
        error: `The page asked about a request this Studio does not show (method ${clampPageText(JSON.stringify(request.method), 20)}): nothing was sent.`,
      };
    }
    let url: URL;
    try {
      url = new URL(request.url, origin);
    } catch {
      return {
        error:
          "The page asked about a request with no address: nothing was sent.",
      };
    }
    if (url.origin !== origin) {
      return {
        error: `The page tried to send data to another site (${clampPageText(url.origin, 80)}), which is never allowed from the preview: nothing was sent.`,
      };
    }
    requests.push({
      via: request.via,
      method,
      url: clampPageText(`${url.pathname}${url.search}`, 200),
    });
  }
  const page = sitePathOf(approval.page, origin);
  return {
    approval: {
      hold: approval.hold,
      page: "path" in page ? clampPageText(page.path, 200) : "this page",
      label: clampPageText(approval.label.replace(/["'`“”‘’]/g, ""), 60),
      did: clampPageText(approval.did, 200),
      before: { url: clampPageText(approval.before.url, 200) },
      requests,
    },
  };
}
