/**
 * The analytics wire format, version 1: what the browser sends to
 * `POST /api/val/analytics`. See `docs/plans/analytics.md`, "Wire format".
 *
 * Nothing in this directory may import `@valbuild/core`, `@valbuild/shared`
 * or zod: this is code every visitor of a site downloads, and those three are
 * most of the weight Val already puts on a page (`client-bundle-weight.md`).
 * `imports.test.ts` keeps it so. The zod schema the server parses this with
 * is `AnalyticsBeacon` in `@valbuild/shared/internal`, and `beacon.test.ts`
 * checks the two agree.
 */

export type AnalyticsDevice = "phone" | "tablet" | "desktop";

export type AnalyticsUtm = {
  source?: string;
  medium?: string;
  campaign?: string;
};

/** What only the first beacon of a page view carries. Its presence IS the page view. */
export type AnalyticsPageView = {
  /** `document.referrer`'s host, only when it is another site. */
  ref?: string;
  utm?: AnalyticsUtm;
  device: AnalyticsDevice;
};

/** Module file path → module paths (the part of a source path after `?p=`). */
export type AnalyticsPaths = Record<string, string[]>;

export type AnalyticsBeacon = {
  v: 1;
  /** `location.pathname`, never the query or the hash. */
  route: string;
  /** The content version the page was rendered from, when the page knows it. */
  cv?: string;
  view?: AnalyticsPageView;
  rendered: AnalyticsPaths;
  viewed: AnalyticsPaths;
};

/** The receiver cuts anything above these; the sender never sends more. */
export const MAX_PATHS_PER_BEACON = 200;
export const MAX_ROUTE_LENGTH = 512;
export const MAX_UTM_LENGTH = 100;

const MODULE_FILE_PATH_SEP = "?p=";

/** Phone below 640 px of viewport width, tablet below 1024, desktop above. */
export function deviceOf(viewportWidth: number): AnalyticsDevice {
  if (viewportWidth < 640) {
    return "phone";
  }
  if (viewportWidth < 1024) {
    return "tablet";
  }
  return "desktop";
}

/**
 * The referrer's host, when it is another site -- never its path or query,
 * which can carry anything. A referrer from this site is navigation within it,
 * not a source.
 */
export function referrerHostOf(
  referrer: string,
  ownHost: string,
): string | undefined {
  if (!referrer) {
    return undefined;
  }
  let host: string;
  try {
    host = new URL(referrer).host;
  } catch {
    return undefined;
  }
  if (!host || host === ownHost) {
    return undefined;
  }
  return host;
}

/** `utm_source`, `utm_medium` and `utm_campaign`, and no other parameter. */
export function utmOf(search: string): AnalyticsUtm | undefined {
  const params = new URLSearchParams(search);
  const utm: AnalyticsUtm = {};
  for (const key of ["source", "medium", "campaign"] as const) {
    const value = params.get(`utm_${key}`);
    if (value) {
      utm[key] = value.slice(0, MAX_UTM_LENGTH);
    }
  }
  return Object.keys(utm).length > 0 ? utm : undefined;
}

export function routeOf(pathname: string): string {
  return pathname.slice(0, MAX_ROUTE_LENGTH);
}

/** Splits a source path into its module file path and its module path. */
function splitSourcePath(sourcePath: string): [string, string] {
  const at = sourcePath.indexOf(MODULE_FILE_PATH_SEP);
  if (at === -1) {
    return [sourcePath, ""];
  }
  return [
    sourcePath.slice(0, at),
    sourcePath.slice(at + MODULE_FILE_PATH_SEP.length),
  ];
}

function group(sourcePaths: readonly string[]): AnalyticsPaths {
  const grouped: AnalyticsPaths = {};
  for (const sourcePath of sourcePaths) {
    const [moduleFilePath, modulePath] = splitSourcePath(sourcePath);
    (grouped[moduleFilePath] ??= []).push(modulePath);
  }
  return grouped;
}

/**
 * The beacons that carry `rendered` and `viewed`, at most
 * `MAX_PATHS_PER_BEACON` paths each. `view`, when given, goes in the first.
 * Returns none when there is nothing to say.
 */
export function buildBeacons(args: {
  route: string;
  cv?: string;
  view?: AnalyticsPageView;
  rendered: readonly string[];
  viewed: readonly string[];
}): AnalyticsBeacon[] {
  type Counted = { kind: "rendered" | "viewed"; path: string };
  const all: Counted[] = [
    ...args.rendered.map((path): Counted => ({ kind: "rendered", path })),
    ...args.viewed.map((path): Counted => ({ kind: "viewed", path })),
  ];
  if (all.length === 0 && !args.view) {
    return [];
  }
  const beacons: AnalyticsBeacon[] = [];
  for (
    let start = 0;
    start < Math.max(all.length, 1);
    start += MAX_PATHS_PER_BEACON
  ) {
    const chunk = all.slice(start, start + MAX_PATHS_PER_BEACON);
    const beacon: AnalyticsBeacon = {
      v: 1,
      route: args.route,
      rendered: group(
        chunk.filter((p) => p.kind === "rendered").map((p) => p.path),
      ),
      viewed: group(
        chunk.filter((p) => p.kind === "viewed").map((p) => p.path),
      ),
    };
    if (args.cv) {
      beacon.cv = args.cv;
    }
    if (start === 0 && args.view) {
      beacon.view = args.view;
    }
    beacons.push(beacon);
  }
  return beacons;
}
