import { ExternalUrlIssue } from "./externalUrlChecks";
import { canonicalExternalUrl } from "./externalUrls";

/**
 * What happened when a URL was actually opened.
 *
 * The other half of checking an external page, and the half that finds link
 * rot: nothing in `externalUrlChecks.ts` can tell a live URL from one that has
 * 404ed since it was added, because the string is identical either way.
 *
 * It cannot run in the browser. A cross-origin `fetch` from the Studio cannot
 * read a response status without CORS headers the target site has no reason to
 * send, and a `no-cors` request answers opaquely for everything — so the check
 * is a request the app's own server makes, and this module is the shape of what
 * comes back. See `docs/plans/external-page-link-checks.md`.
 */
export type ExternalUrlProbeResult =
  | {
      kind: "answered";
      /** The final status, after redirects were followed. */
      code: number;
      /**
       * Where the request ended up. Equal to the URL asked about unless it
       * redirected - which is a finding of its own, and one of the more useful
       * ones: a link that still works but has moved.
       */
      finalUrl: string;
      /** Round trip, for the detail pane. */
      ms: number;
    }
  | { kind: "unreachable"; message: string }
  | { kind: "timeout"; ms: number }
  /** Not attempted, and why. Not a failure: the report has to say which. */
  | { kind: "skipped"; message: string };

export type ExternalUrlProbe =
  | { state: "checking" }
  | { state: "done"; result: ExternalUrlProbeResult };

/**
 * Opens a batch of URLs and reports each one as it answers.
 *
 * A callback per result rather than one resolved map, because the report is
 * worth watching fill in: checking forty links is seconds of waiting, and a
 * list that arrives all at once at the end looks like nothing is happening.
 * The promise resolves when every URL has been reported or the signal aborts.
 */
export type ExternalUrlProber = (
  urls: readonly string[],
  onResult: (url: string, result: ExternalUrlProbeResult) => void,
  signal: AbortSignal,
) => Promise<void>;

/**
 * Statuses that say "this link is probably fine, but not from here".
 *
 * A page behind a login answers 401 or 403 to an anonymous server and 200 to
 * the person who added the link; a site that rate-limits answers 429 to
 * anything checking forty URLs at once. Reporting those as broken would train
 * everyone to ignore the check, which is worse than not having it.
 */
const UNVERIFIABLE = new Set([401, 403, 429]);

/** What a probe result means, in the same shape the shape checks produce. */
export function probeIssues(
  url: string,
  result: ExternalUrlProbeResult,
): ExternalUrlIssue[] {
  switch (result.kind) {
    case "skipped":
      return [];
    case "timeout":
      return [
        {
          code: "check-timeout",
          severity: "warning",
          message: `Did not answer within ${Math.round(result.ms / 1000)}s. It may be slow rather than gone.`,
        },
      ];
    case "unreachable":
      return [
        {
          code: "unreachable",
          severity: "error",
          message: `Could not be reached: ${result.message}`,
        },
      ];
    case "answered":
      return answeredIssues(url, result);
  }
}

function answeredIssues(
  url: string,
  result: { code: number; finalUrl: string; ms: number },
): ExternalUrlIssue[] {
  const { code, finalUrl } = result;
  if (code === 404 || code === 410) {
    return [
      {
        code: "http-not-found",
        severity: "error",
        message:
          code === 410
            ? "Answered 410 Gone: the page was deliberately removed."
            : "Answered 404 Not Found: there is no page here any more.",
      },
    ];
  }
  if (UNVERIFIABLE.has(code)) {
    return [
      {
        code: "http-unverifiable",
        severity: "warning",
        message: `Answered ${code}. The page may be fine for a visitor - it cannot be checked from the server.`,
      },
    ];
  }
  if (code >= 400 && code < 500) {
    return [
      {
        code: "http-client-error",
        severity: "error",
        message: `Answered ${code}. The site refused the request.`,
      },
    ];
  }
  if (code >= 500) {
    return [
      {
        code: "http-server-error",
        severity: "warning",
        message: `Answered ${code}. The site is having trouble, which may be temporary.`,
      },
    ];
  }
  // 2xx and 3xx. A redirect that resolved is a working link that has moved,
  // which is worth saying: the next move may be the one that 404s.
  if (canonicalExternalUrl(finalUrl) !== canonicalExternalUrl(url)) {
    return [
      {
        code: "http-redirected",
        severity: "warning",
        message: `Redirects to ${finalUrl}. Link to that directly instead.`,
      },
    ];
  }
  return [];
}

/** The one-line fact under the issues: what answered, and how fast. */
export function probeSummary(result: ExternalUrlProbeResult): string {
  switch (result.kind) {
    case "answered":
      return `Answered ${result.code} in ${result.ms} ms.`;
    case "timeout":
      return `No answer within ${Math.round(result.ms / 1000)}s.`;
    case "unreachable":
      return "No answer.";
    case "skipped":
      return result.message;
  }
}

/**
 * The URLs in a batch that are worth opening, and why the others are not.
 *
 * A key that is not an absolute http(s) URL has nothing to open, and saying
 * "unreachable" about it would repeat the shape error in a more alarming voice.
 * Local addresses are skipped here as well as refused by the server: the server
 * must refuse them regardless - it is the one being asked to make requests at
 * somebody else's say-so - but skipping first turns a security guard into an
 * explanation.
 *
 * `mailto:` and `tel:` are the case where "skipped" is not a shortfall at all:
 * they are valid external pages that simply have no page, so the message says
 * that rather than naming a limit of the checker. The report counts them apart
 * from the ones that passed for the same reason - claiming a phone number is
 * reachable would be a check nobody ran.
 */
export function partitionProbeTargets(urls: readonly string[]): {
  probe: string[];
  skipped: Map<string, ExternalUrlProbeResult>;
} {
  const probe: string[] = [];
  const skipped = new Map<string, ExternalUrlProbeResult>();
  for (const url of urls) {
    const trimmed = url.trim();
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      skipped.set(url, {
        kind: "skipped",
        message: "Not opened: this is not a URL.",
      });
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      skipped.set(url, {
        kind: "skipped",
        message: notOpenedMessage(parsed.protocol.replace(/:$/, "")),
      });
      continue;
    }
    probe.push(url);
  }
  return { probe, skipped };
}

/** Why a scheme was not opened, said as a fact about the scheme. */
function notOpenedMessage(scheme: string): string {
  switch (scheme) {
    case "mailto":
      return "Nothing to open: an email address is not a page.";
    case "tel":
      return "Nothing to open: a phone number is not a page.";
    default:
      return `Nothing to open: "${scheme}:" is not a request a browser makes over the network.`;
  }
}
