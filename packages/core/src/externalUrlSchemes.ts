/**
 * Which URL schemes an external page key may use.
 *
 * External pages are the URLs a site links OUT to, and a link is not only a web
 * page: `mailto:` on a contact page and `tel:` on a phone number are the same
 * kind of thing to whoever maintains the list, and were refused outright.
 *
 * So the default is a deny list rather than an allow list — anything with a
 * scheme, except the handful that are not links at all. Listing every scheme
 * worth linking to is a list that is wrong the moment someone wants
 * `whatsapp:` or `msteams:`, and being wrong that way means an editor cannot
 * store a URL their site genuinely uses.
 *
 * A project that wants to be stricter says so:
 *
 * ```ts
 * s.router(externalPageRouter({ schemes: ["https", "mailto"] }), item)
 * ```
 */

/**
 * The schemes that are refused however wide the policy is.
 *
 * Not a style preference. An external page key ends up in an `href` in the
 * consuming site's own markup, so `javascript:` there is stored XSS on that
 * site, and `data:` is the same trick wearing a document. `vbscript:` is the
 * historical spelling of the first. `file:` and `blob:` address the visitor's
 * own machine rather than anywhere on the internet.
 *
 * These stay refused even when a project lists them in `schemes`: a config
 * option is not a good enough reason to let content inject script into the
 * page that renders it.
 */
export const UNSAFE_URL_SCHEMES = [
  "javascript",
  "data",
  "vbscript",
  "file",
  "blob",
] as const;

export type ExternalUrlSchemePolicy = {
  /**
   * The only schemes allowed, without the colon: `["https", "mailto"]`.
   *
   * Absent means the wide default — anything but {@link UNSAFE_URL_SCHEMES}.
   */
  schemes?: readonly string[];
};

/** The scheme of a URL, lowercased and without the colon, or null. */
export function schemeOf(url: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url.trim());
  return match === null ? null : match[1].toLowerCase();
}

export type SchemeRejection =
  | { reason: "no-scheme" }
  | { reason: "unsafe"; scheme: string }
  | { reason: "not-allowed"; scheme: string; allowed: readonly string[] };

/** `null` when the URL's scheme is acceptable under `policy`. */
export function rejectScheme(
  url: string,
  policy: ExternalUrlSchemePolicy = {},
): SchemeRejection | null {
  const scheme = schemeOf(url);
  if (scheme === null) {
    return { reason: "no-scheme" };
  }
  if ((UNSAFE_URL_SCHEMES as readonly string[]).includes(scheme)) {
    return { reason: "unsafe", scheme };
  }
  if (policy.schemes !== undefined) {
    const allowed = policy.schemes.map((s) => s.toLowerCase());
    if (!allowed.includes(scheme)) {
      return { reason: "not-allowed", scheme, allowed: policy.schemes };
    }
  }
  return null;
}

/** What to tell whoever wrote the key. */
export function describeSchemeRejection(rejection: SchemeRejection): string {
  switch (rejection.reason) {
    case "no-scheme":
      return "Must start with a scheme, like https:// or mailto:.";
    case "unsafe":
      return `"${rejection.scheme}:" cannot be used in a link: it runs code or reads the visitor's own machine rather than pointing at somewhere on the internet.`;
    case "not-allowed":
      return `"${rejection.scheme}:" is not one of the schemes this router allows (${rejection.allowed.join(", ")}).`;
  }
}

/**
 * Whether a link check can open this URL.
 *
 * Separate from whether it is ALLOWED, and the two are not the same question:
 * `mailto:` is a perfectly good external page and there is no request to make
 * of it. A URL that cannot be opened is reported as not checked, never as
 * broken.
 */
export function isCheckableScheme(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme === "http" || scheme === "https";
}
