import {
  describeSchemeRejection,
  ExternalUrlSchemePolicy,
  rejectScheme,
} from "@valbuild/core";
import { asHttps, canonicalExternalUrl } from "./externalUrls";

/**
 * Checks over the SHAPE of an external URL — what can be decided from the
 * string and from the other strings beside it.
 *
 * Deliberately not a link checker. Nothing here asks the network, so nothing
 * here finds a dead link; what it finds is the class of mistake that is made
 * while typing and then never looked at again: a key that the router will
 * refuse, a password pasted into content, the same page listed twice, a
 * localhost URL that worked on the machine it was added from.
 *
 * Pure and synchronous, so the list can show them without anyone asking. The
 * Check button exists for the opposite reason — to say "these are fine" about a
 * batch, which a row that quietly has no badge does not say.
 */
export type ExternalUrlIssueCode =
  /**
   * The entry behind the URL does not validate.
   *
   * Not a finding of this module - it comes from the project's own schema and
   * whatever `.validate(...)` it carries, and it is the one code here that
   * blocks a publish. It is in this union so that a row has ONE list of things
   * wrong with it: the badge, the Flagged filter, the toolbar totals and the
   * group warning all read that list, and a URL whose entry is invalid wants
   * looking at by every one of those measures.
   */
  | "entry-invalid"
  // Shape: decided from the string, and from the strings beside it.
  | "scheme-refused"
  | "unparseable"
  | "whitespace"
  | "credentials"
  | "insecure-scheme"
  | "duplicate"
  | "local-host"
  | "tracking-params"
  // Reachability: decided by opening the URL. See `externalUrlReachability.ts`.
  | "http-not-found"
  | "http-client-error"
  | "http-unverifiable"
  | "http-server-error"
  | "http-redirected"
  | "unreachable"
  | "check-timeout";

export type ExternalUrlIssue = {
  code: ExternalUrlIssueCode;
  /**
   * `error` is a URL that is wrong — the router refuses it, or it carries
   * something that must not be in content. `warning` is a URL that works and
   * probably should not be what it is.
   */
  severity: "error" | "warning";
  /** One line, addressed to whoever typed the URL. */
  message: string;
};

/** The worst severity in a set of issues, for a row's single badge. */
export type ExternalUrlStatus = "ok" | "warning" | "error";

export function statusOf(
  issues: readonly ExternalUrlIssue[],
): ExternalUrlStatus {
  if (issues.some((issue) => issue.severity === "error")) return "error";
  if (issues.length > 0) return "warning";
  return "ok";
}

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
];

/**
 * Hosts that resolve to the machine the URL was added from, or to nothing at
 * all for a visitor. `.local` and `.internal` are reserved for exactly this,
 * and the three private IPv4 ranges are matched by prefix rather than parsed:
 * a host that merely LOOKS like `10.x` is worth the same warning.
 */
function isLocalHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/**
 * Check every URL in the list, against itself and against the others.
 *
 * Takes the whole list because two of the checks are about the list rather than
 * about a URL: whether the same page is listed twice, and whether an `http://`
 * link has an `https://` twin already sitting beside it. A per-URL function
 * could not see either, and both are the ones worth acting on.
 *
 * Returns a Map keyed by the URL exactly as it appears in the record, so a
 * caller can look up the row it is rendering without re-deriving anything.
 */
export function checkExternalUrls(
  urls: readonly string[],
  policy: ExternalUrlSchemePolicy = {},
): Map<string, ExternalUrlIssue[]> {
  const canonicalCounts = new Map<string, string[]>();
  for (const url of urls) {
    const canonical = canonicalExternalUrl(url);
    const existing = canonicalCounts.get(canonical);
    if (existing) {
      existing.push(url);
    } else {
      canonicalCounts.set(canonical, [url]);
    }
  }
  const secure = new Set(
    urls
      .filter((url) => url.trim().toLowerCase().startsWith("https://"))
      .map((url) => canonicalExternalUrl(url)),
  );

  const result = new Map<string, ExternalUrlIssue[]>();
  for (const url of urls) {
    result.set(url, checkOne(url, canonicalCounts, secure, policy));
  }
  return result;
}

function checkOne(
  url: string,
  canonicalCounts: ReadonlyMap<string, string[]>,
  secure: ReadonlySet<string>,
  policy: ExternalUrlSchemePolicy,
): ExternalUrlIssue[] {
  const issues: ExternalUrlIssue[] = [];
  const trimmed = url.trim();

  if (trimmed !== url || /\s/.test(trimmed)) {
    issues.push({
      code: "whitespace",
      severity: "error",
      message: "Has whitespace in it, which is almost certainly a typo.",
    });
  }

  // The rule `externalPageRouter.validate` enforces, from the same function:
  // any scheme but the handful that are not links, narrowed to a list where
  // the project asked for one. Nothing below this can be decided about a key
  // whose scheme the router will refuse, so this returns early.
  const rejection = rejectScheme(trimmed, policy);
  if (rejection !== null) {
    issues.push({
      code: "scheme-refused",
      severity: "error",
      message: describeSchemeRejection(rejection),
    });
    return issues;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    issues.push({
      code: "unparseable",
      severity: "error",
      message: "Is not a URL a browser can open.",
    });
    return issues;
  }

  const canonical = canonicalExternalUrl(trimmed);
  const samePage = canonicalCounts.get(canonical) ?? [];
  const others = samePage.filter((other) => other !== url);
  if (others.length > 0) {
    issues.push({
      code: "duplicate",
      severity: "warning",
      message: `Is the same page as ${others.map((other) => `"${other}"`).join(", ")}, which ${others.length === 1 ? "is" : "are"} also in the list.`,
    });
  }

  // Everything from here reads an authority — credentials, a host, query
  // parameters a server will see. `mailto:` and `tel:` have none of that, so
  // the list check above is the last thing that can be said about them.
  if (parsed.hostname === "") {
    return issues;
  }

  const isHttp = parsed.protocol === "http:";

  if (parsed.username !== "" || parsed.password !== "") {
    issues.push({
      code: "credentials",
      severity: "error",
      message:
        "Carries a username and password. Anyone who can read the site can read them.",
    });
  }

  if (isHttp) {
    const twin = secure.has(asHttps(trimmed));
    issues.push({
      code: "insecure-scheme",
      severity: "warning",
      message: twin
        ? "Uses http://, and the https:// version of the same page is already in the list."
        : "Uses http://. Browsers warn on it, and most sites answer on https://.",
    });
  }

  // `hostname`, not `host`: a port is not part of the answer, and
  // `localhost:3000` is the commonest way this one shows up.
  if (isLocalHost(parsed.hostname.toLowerCase())) {
    issues.push({
      code: "local-host",
      severity: "warning",
      message:
        "Points at a local address. It will not resolve for anyone visiting the site.",
    });
  }

  const tracking = TRACKING_PARAMS.filter((param) =>
    parsed.searchParams.has(param),
  );
  if (tracking.length > 0) {
    issues.push({
      code: "tracking-params",
      severity: "warning",
      message: `Carries tracking parameters (${tracking.join(", ")}) that will be attributed to every visitor who follows it.`,
    });
  }

  return issues;
}
