/**
 * Taking an external page's URL apart, for a list whose keys ARE the URLs.
 *
 * The external router is a record keyed by absolute URL — there is no separate
 * label — so every affordance in the list is derived from the key. That makes
 * the key a person typed the only input here, and "not a URL at all" a state to
 * render rather than a case to assume away: `externalPageRouter.validate` is
 * what refuses a bad key, and it runs after the editor has already saved one.
 */

/** One external URL, taken apart for display. */
export type ParsedExternalUrl = {
  /**
   * Lowercased host (`status.example.com`), or null when the URL has none —
   * it did not parse, or its scheme addresses something that is not a host.
   */
  host: string | null;
  /**
   * What the list groups by: the registrable domain, so a project's four
   * `*.example.com` links read as one cluster rather than four strangers.
   *
   * A `mailto:` groups under the domain it writes to, which puts
   * `mailto:post@example.com` in the same cluster as `https://example.com` —
   * the same organisation, which is what the heading is about. Schemes with
   * no domain at all (`tel:`) get a heading of their own.
   */
  group: string;
  /**
   * What a row shows inside its group — the URL minus what the group header
   * already said. Never empty: a bare `https://example.com` falls back to its
   * host, because a row labelled with nothing is a row you cannot click on
   * purpose.
   */
  label: string;
  /** The scheme without the colon, lowercased: `https`, `mailto`, or null. */
  scheme: string | null;
};

/** The group a URL that does not parse is filed under. */
export const NOT_A_URL_GROUP = "Not a URL";

/** The group `tel:` keys are filed under. */
export const PHONE_GROUP = "Phone numbers";

/**
 * Second-level domains that are really part of the suffix.
 *
 * A correct answer needs the public suffix list, which is a megabyte that would
 * have to ship in the Studio bundle to decide where a *heading* goes. This is
 * the short list that covers what people actually have, and being wrong costs a
 * group header, never a link: rows carry their own host, and nothing but the
 * grouping reads this.
 */
const SHARED_SECOND_LEVEL = new Set([
  "co",
  "com",
  "org",
  "net",
  "ac",
  "gov",
  "edu",
  "mil",
  "sch",
]);

/**
 * The domain a host is grouped under: `status.example.com` → `example.com`,
 * `shop.example.co.uk` → `example.co.uk`.
 */
export function registrableDomain(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) {
    return host;
  }
  const secondLast = labels[labels.length - 2];
  const take =
    SHARED_SECOND_LEVEL.has(secondLast) && labels.length >= 3 ? 3 : 2;
  return labels.slice(-take).join(".");
}

export function parseExternalUrl(url: string): ParsedExternalUrl {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { host: null, group: NOT_A_URL_GROUP, label: url, scheme: null };
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (parsed.hostname === "") {
    // No authority to group by: `mailto:` and `tel:` put everything after the
    // colon in `pathname`. Grouping them by scheme alone would file every
    // address a site has under one heading called "mailto", so a mail domain
    // is read out of the address instead and shares the heading with the web
    // pages of the same organisation.
    const group = hostlessGroup(scheme, parsed.pathname);
    return { host: null, group, label: trimmed, scheme };
  }
  const host = parsed.host.toLowerCase();
  // Grouped by the hostname, displayed with the port: `localhost:3000` and
  // `localhost:4000` are one group and two visibly different rows.
  const group = registrableDomain(parsed.hostname.toLowerCase());
  return {
    host,
    group,
    label: labelOf(trimmed, group),
    scheme,
  };
}

/**
 * The heading for a URL whose scheme has no host: the mail domain where there
 * is one, a name where there is not.
 *
 * Deliberately tolerant. `mailto:` takes a comma-separated list and a query
 * string, and `mailto:` with nothing after it is a key someone is mid-way
 * through typing — none of that should throw, and a heading is the only thing
 * riding on the answer.
 */
function hostlessGroup(scheme: string, pathname: string): string {
  if (scheme === "tel") {
    return PHONE_GROUP;
  }
  if (scheme === "mailto") {
    const first = pathname.split(",")[0];
    const at = first.lastIndexOf("@");
    const domain = at === -1 ? "" : first.slice(at + 1).toLowerCase();
    return domain === "" ? "mailto:" : registrableDomain(domain);
  }
  return `${scheme}:`;
}

/**
 * A row's label: the key itself, minus what the group heading above it already
 * says.
 *
 * Cut out of the RAW key rather than reassembled from the parsed parts, and
 * that is the whole design of this function. Rebuilding it dropped a trailing
 * slash, a default port and the `http://` - which are, exactly, the three
 * things the checks flag. Two rows that the list says are the same page then
 * looked identical, and an `http://` link looked like its `https://` twin.
 *
 * So only two prefixes are ever removed: the group heading when the row is
 * directly on it, and a plain `https://`. Anything else - another scheme,
 * credentials in the URL, a key that is not a URL at all - is shown whole,
 * because a row that hides the thing that is wrong with it is worse than a
 * long row.
 */
function labelOf(url: string, group: string): string {
  const onGroup = `https://${group}`;
  if (url.toLowerCase().startsWith(onGroup)) {
    const rest = url.slice(onGroup.length);
    if (
      rest === "" ||
      rest.startsWith("/") ||
      rest.startsWith("?") ||
      rest.startsWith("#")
    ) {
      return rest === "" ? group : rest;
    }
  }
  if (url.toLowerCase().startsWith("https://")) {
    return url.slice("https://".length);
  }
  return url;
}

/**
 * A URL reduced to the page it actually addresses, for spotting two keys that
 * are the same link written twice.
 *
 * Scheme is KEPT: `http://` and `https://` are different requests, and folding
 * them together here would hide the one difference the insecure-scheme check
 * exists to point at. Everything that a server treats as noise — case in the
 * host, the default port, a trailing slash, a fragment — is dropped.
 */
export function canonicalExternalUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return url.trim();
  }
  if (parsed.hostname === "") {
    // `mailto:` and `tel:` have no authority, so there is no `//` and nothing
    // to lowercase: an email local part is case-sensitive by the spec, and
    // folding it here would call two different addresses one duplicate.
    return `${parsed.protocol}${parsed.pathname}${parsed.search}`;
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
}

/** The same URL as `https`, for asking whether an http link has a twin. */
export function asHttps(url: string): string {
  return canonicalExternalUrl(url).replace(/^http:/, "https:");
}
