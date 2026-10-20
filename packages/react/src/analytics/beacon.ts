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

/**
 * The receiver rejects a beacon above these (`AnalyticsBeacon` in
 * `@valbuild/shared/internal` repeats them), so the sender never sends more:
 * it cuts or drops what is longer, and splits what is larger.
 */
export const MAX_PATHS_PER_BEACON = 200;
export const MAX_ROUTE_LENGTH = 512;
export const MAX_UTM_LENGTH = 100;
/** A host name is at most 253 characters (RFC 1035). */
export const MAX_REF_LENGTH = 253;
export const MAX_CV_LENGTH = 128;
export const MAX_MODULE_FILE_PATH_LENGTH = 512;
export const MAX_MODULE_PATH_LENGTH = 1024;
/**
 * A beacon's size in bytes of JSON, below the 16 KB Val's hosting accepts --
 * 200 long router keys are about 18 KB. `sendBeacon` itself takes 64 KB.
 */
export const MAX_BEACON_BYTES = 12_000;

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
  return host.slice(0, MAX_REF_LENGTH);
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

/**
 * The beacons that carry `rendered` and `viewed`: at most
 * `MAX_PATHS_PER_BEACON` paths and about `MAX_BEACON_BYTES` each. `view`, when
 * given, goes in the first. Returns none when there is nothing to say.
 *
 * A path longer than the receiver takes is dropped rather than cut: half a
 * path names some other content, or none.
 */
export function buildBeacons(args: {
  route: string;
  cv?: string;
  view?: AnalyticsPageView;
  rendered: readonly string[];
  viewed: readonly string[];
}): AnalyticsBeacon[] {
  type Counted = {
    kind: "rendered" | "viewed";
    moduleFilePath: string;
    modulePath: string;
  };
  const counted = (kind: Counted["kind"], sourcePath: string): Counted[] => {
    const [moduleFilePath, modulePath] = splitSourcePath(sourcePath);
    if (
      moduleFilePath.length > MAX_MODULE_FILE_PATH_LENGTH ||
      modulePath.length > MAX_MODULE_PATH_LENGTH
    ) {
      return [];
    }
    return [{ kind, moduleFilePath, modulePath }];
  };
  const all: Counted[] = [
    ...args.rendered.flatMap((path) => counted("rendered", path)),
    ...args.viewed.flatMap((path) => counted("viewed", path)),
  ];
  if (all.length === 0 && !args.view) {
    return [];
  }
  const cv = args.cv?.slice(0, MAX_CV_LENGTH);
  const empty = (withView: boolean): AnalyticsBeacon => {
    const beacon: AnalyticsBeacon = {
      v: 1,
      route: args.route,
      rendered: {},
      viewed: {},
    };
    if (cv) {
      beacon.cv = cv;
    }
    if (withView && args.view) {
      beacon.view = args.view;
    }
    return beacon;
  };
  const beacons: AnalyticsBeacon[] = [];
  let beacon = empty(true);
  let paths = 0;
  let bytes = byteLength(JSON.stringify(beacon));
  // What adding a path costs: the path and a comma, and a new key when its
  // module is not in this beacon yet. An estimate in UTF-8 bytes, close
  // enough to keep well under the limit.
  const costOf = (path: Counted) =>
    byteLength(JSON.stringify(path.modulePath)) +
    1 +
    (beacon[path.kind][path.moduleFilePath]
      ? 0
      : byteLength(JSON.stringify(path.moduleFilePath)) + 4);
  for (const path of all) {
    let cost = costOf(path);
    if (
      paths > 0 &&
      (paths === MAX_PATHS_PER_BEACON || bytes + cost > MAX_BEACON_BYTES)
    ) {
      beacons.push(beacon);
      beacon = empty(false);
      paths = 0;
      bytes = byteLength(JSON.stringify(beacon));
      cost = costOf(path);
    }
    (beacon[path.kind][path.moduleFilePath] ??= []).push(path.modulePath);
    paths += 1;
    bytes += cost;
  }
  beacons.push(beacon);
  return beacons;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
