import { Internal } from "@valbuild/core";
import { utf8ToBytes } from "./bytes";

/**
 * Content analytics on a SELF-HOSTED site: handing a visitor's beacon on to
 * Val's ingest, which counts it.
 *
 * On a site Val hosts, the platform's loader answers `POST /api/val/analytics`
 * before the app sees it. Anywhere else the beacon reaches this server, and
 * the only thing that can count it is the ingest -- which only takes it from a
 * server holding the project's api key, so the browser cannot send it there
 * itself.
 *
 * Kept out of `ValServer.ts` so it can be tested on its own, and free of Node
 * for the same reason the rest of the request handlers are: the demo runs
 * them in a browser tab (`noNodeFromBrowser.test.ts`).
 */

/** Where beacons go, unless `VAL_ANALYTICS_INGEST_URL` says otherwise. */
export const DEFAULT_ANALYTICS_INGEST_URL =
  "https://platform.valstart.dev/__ingest/analytics";

/**
 * The most the ingest takes: it answers 413 above this. The browser script
 * keeps its beacons well below it (`MAX_BEACON_BYTES` in
 * `@valbuild/react/analytics`), so one that is not was not built by it.
 */
export const MAX_FORWARDED_BEACON_BYTES = 16 * 1024;

/** A forward is a visitor's request waiting on another one, so it is short. */
export const ANALYTICS_FORWARD_TIMEOUT_MS = 3_000;

/**
 * The request headers the route reads, by lower-case name. Declared on the
 * route (`Api["/analytics"]`), so the router hands over these and no others:
 * the visitor's IP is never among them.
 */
export type AnalyticsRequestHeaders = {
  "sec-fetch-site"?: string;
  "user-agent"?: string;
  "x-vercel-ip-country"?: string;
  "cf-ipcountry"?: string;
  "cloudfront-viewer-country"?: string;
};

/**
 * Where hosts in front of an app say which country a request came from, in
 * the order they are asked. Each is set by the host, never by the browser.
 */
const COUNTRY_HEADERS: ReadonlyArray<keyof AnalyticsRequestHeaders> = [
  "x-vercel-ip-country",
  "cf-ipcountry",
  "cloudfront-viewer-country",
];

/**
 * The visitor's country, as ISO 3166-1 alpha-2, when a host in front of the
 * app said: the first of {@link COUNTRY_HEADERS} that holds two letters.
 *
 * Anything else is skipped rather than passed on: Cloudflare's `T1` (Tor)
 * is not a country, and `XX` is how it says it does not know.
 */
export function visitorCountry(
  headers: AnalyticsRequestHeaders,
): string | undefined {
  for (const name of COUNTRY_HEADERS) {
    const value = headers[name]?.trim();
    if (value && /^[A-Za-z]{2}$/.test(value)) {
      const country = value.toUpperCase();
      if (country !== "XX") {
        return country;
      }
    }
  }
  return undefined;
}

/**
 * Why a beacon was not handed on, when the reason is the request's. Each of
 * these is answered as before -- `200 { counted: false }` -- because none of
 * them is something the script can do anything about.
 */
export type AnalyticsForwardRefusal =
  | "not-same-origin"
  | "no-user-agent"
  | "too-large";

export type AnalyticsForwardPlan =
  | { ok: true; userAgent: string; country: string | undefined }
  | { ok: false; reason: AnalyticsForwardRefusal };

/**
 * Whether this request may be handed on, and if so what to send. The checks
 * are the ones only this server can make: a server-to-server forward loses
 * `Sec-Fetch-Site`, and the ingest would see this server's User-Agent rather
 * than the visitor's.
 */
export function prepareAnalyticsForward(
  headers: AnalyticsRequestHeaders,
  body: string,
): AnalyticsForwardPlan {
  // A beacon from another site's page is not one of this site's visitors.
  if (headers["sec-fetch-site"] !== "same-origin") {
    return { ok: false, reason: "not-same-origin" };
  }
  // The ingest tells a bot from a person by its User-Agent; without one there
  // is nothing to tell, and nothing a browser sends goes without.
  const userAgent = headers["user-agent"];
  if (!userAgent) {
    return { ok: false, reason: "no-user-agent" };
  }
  if (utf8ToBytes(body).length > MAX_FORWARDED_BEACON_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  return { ok: true, userAgent, country: visitorCountry(headers) };
}

/**
 * What the ingest said, or that it could not be asked: `null` for a forward
 * that threw or timed out. Never a throw -- a visitor's beacon failing to go
 * further is not the visitor's problem.
 */
export async function forwardAnalyticsBeacon(args: {
  ingestUrl: string;
  apiKey: string;
  project: string;
  body: string;
  userAgent: string;
  country: string | undefined;
  timeoutMs?: number;
}): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? ANALYTICS_FORWARD_TIMEOUT_MS,
  );
  const headers: Record<string, string> = {
    authorization: `Bearer ${args.apiKey}`,
    "x-val-project": args.project,
    "x-val-visitor-user-agent": args.userAgent,
    "content-type": "text/plain;charset=UTF-8",
  };
  if (args.country !== undefined) {
    headers["x-val-visitor-country"] = args.country;
  }
  try {
    const res = await fetch(args.ingestUrl, {
      method: "POST",
      headers,
      body: args.body,
      signal: controller.signal,
    });
    // Nothing in an answer is read but its status. Cancelled rather than left
    // for the garbage collector, which in Node holds the connection until then.
    try {
      await res.body?.cancel();
    } catch {
      // Already read or closed: nothing to free.
    }
    return res.status;
  } catch (err) {
    Internal.log.debug(
      `analytics: could not forward a beacon to ${args.ingestUrl}`,
      err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let warnedUnauthorized = false;

/**
 * The ingest refused this server's api key: a misconfiguration the site's
 * developer can fix, and the same one on every beacon. So it is said once a
 * process, where a warning per visitor would bury everything else.
 */
export function warnAnalyticsUnauthorizedOnce(project: string): void {
  if (warnedUnauthorized) {
    return;
  }
  warnedUnauthorized = true;
  Internal.log.warn(
    `Content analytics is not being counted: Val's analytics ingest did not accept this site's api key for the project "${project}" (401). ` +
      "Check that VAL_API_KEY is an api key of that project, and that VAL_PROJECT names it as org/project.",
  );
}
