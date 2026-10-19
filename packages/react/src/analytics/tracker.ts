import {
  type AnalyticsBeacon,
  type AnalyticsPageView,
  buildBeacons,
  deviceOf,
  referrerHostOf,
  routeOf,
  utmOf,
} from "./beacon";
import { splitValPaths } from "./splitValPaths";

export type ValAnalyticsOptions = {
  /** Where beacons go. Default `/api/val/analytics`, on the site's own origin. */
  endpoint?: string;
  /** The content version the page was rendered from, sent as `cv`. */
  contentVersion?: string;
  /** How long after a page view starts its first beacon goes. Default 3 s. */
  firstSendAfterMs?: number;
  /** How long an element must stay on screen to count as viewed. Default 1 s. */
  viewedAfterMs?: number;
  /** How many new paths make a beacon worth sending before the page is left. Default 50. */
  sendWhenPending?: number;
  /** The shortest time between two of those. Default 15 s. */
  minSendIntervalMs?: number;
};

export type ValAnalytics = {
  /** Sends what is waiting now. */
  flush(): void;
  /** Sends what is waiting, then stops counting and restores everything it patched. */
  stop(): void;
};

const SELECTOR = "[data-val-path]";
const ATTRIBUTE = "data-val-path";
/** Every 5%, so an element far taller than the screen still crosses one. */
const THRESHOLDS = Array.from({ length: 21 }, (_, i) => i / 20);

/**
 * Counts which content a visitor's page shows, and sends it.
 *
 * - **Rendered**: an element with a `data-val-path` is in the document.
 * - **Viewed**: one is at least half visible -- or covers at least half the
 *   viewport, for an element taller than it -- for `viewedAfterMs` without a
 *   break, while the page is visible.
 *
 * Each path counts at most once of each per page view. A page view starts with
 * the page and with every client-side navigation to another pathname; content
 * still on screen after one (a header, a footer) counts again for the new one,
 * because it was rendered on it.
 *
 * Returns null where it does nothing: on the server, and for an automated
 * browser (`navigator.webdriver`). The caller decides the rest -- draft mode,
 * the Studio's canvas and an editor browsing with Val enabled all count
 * nothing, and the provider does not start it for them.
 */
export function startValAnalytics(
  options: ValAnalyticsOptions = {},
): ValAnalytics | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  if (navigator.webdriver) {
    return null;
  }
  const endpoint = options.endpoint ?? "/api/val/analytics";
  const firstSendAfterMs = options.firstSendAfterMs ?? 3_000;
  const viewedAfterMs = options.viewedAfterMs ?? 1_000;
  const sendWhenPending = options.sendWhenPending ?? 50;
  const minSendIntervalMs = options.minSendIntervalMs ?? 15_000;

  let stopped = false;
  /** The first beacon of the page load is sent with `fetch`, so its status can be read. */
  let sentAny = false;

  // The page view.
  let route = routeOf(location.pathname);
  let view: AnalyticsPageView | null = null;
  let viewSent = false;
  const rendered = new Set<string>();
  const viewed = new Set<string>();
  const pendingRendered: string[] = [];
  const pendingViewed: string[] = [];
  let lastSentAt = 0;
  let firstSendTimer: ReturnType<typeof setTimeout> | null = null;
  let batchTimer: ReturnType<typeof setTimeout> | null = null;

  const viewTimers = new Map<Element, ReturnType<typeof setTimeout>>();

  function pageView(first: boolean, url: URL | Location): AnalyticsPageView {
    const pageView: AnalyticsPageView = { device: deviceOf(innerWidth) };
    // A referrer is where the LOAD came from. A client-side navigation's
    // `document.referrer` is still that, so it is not a source again.
    const ref = first
      ? referrerHostOf(document.referrer, location.host)
      : undefined;
    if (ref) {
      pageView.ref = ref;
    }
    const utm = utmOf(url.search);
    if (utm) {
      pageView.utm = utm;
    }
    return pageView;
  }

  function send(beacon: AnalyticsBeacon, leaving: boolean) {
    const body = JSON.stringify(beacon);
    if (!sentAny && !leaving) {
      sentAny = true;
      // `sendBeacon` cannot read the answer. The first one asks, so a site
      // with analytics off or paused (410) stops sending at once.
      fetch(endpoint, {
        method: "POST",
        body,
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      })
        .then((res) => {
          if (res.status === 410) {
            stop(false);
          }
        })
        .catch(() => {
          // A lost beacon is a rounding error, not something to retry.
        });
      return;
    }
    sentAny = true;
    if (typeof navigator.sendBeacon === "function") {
      // A string body is sent as text/plain, which needs no CORS preflight.
      if (navigator.sendBeacon(endpoint, body)) {
        return;
      }
    }
    fetch(endpoint, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => {
      // As above.
    });
  }

  function flushNow(leaving: boolean) {
    if (firstSendTimer !== null) {
      clearTimeout(firstSendTimer);
      firstSendTimer = null;
    }
    if (batchTimer !== null) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    const beacons = buildBeacons({
      route,
      cv: options.contentVersion,
      view: !viewSent && view ? view : undefined,
      rendered: pendingRendered.splice(0),
      viewed: pendingViewed.splice(0),
    });
    if (beacons.length === 0) {
      return;
    }
    viewSent = true;
    lastSentAt = Date.now();
    for (const beacon of beacons) {
      send(beacon, leaving);
    }
  }

  function maybeSendSoon() {
    if (!viewSent || batchTimer !== null) {
      // Before the first beacon, what is waiting goes with it.
      return;
    }
    if (pendingRendered.length + pendingViewed.length < sendWhenPending) {
      return;
    }
    batchTimer = setTimeout(
      () => {
        batchTimer = null;
        flushNow(false);
      },
      Math.max(0, lastSentAt + minSendIntervalMs - Date.now()),
    );
  }

  function countRendered(element: Element) {
    for (const path of splitValPaths(element.getAttribute(ATTRIBUTE))) {
      if (!rendered.has(path)) {
        rendered.add(path);
        pendingRendered.push(path);
      }
    }
  }

  function countViewed(element: Element) {
    for (const path of splitValPaths(element.getAttribute(ATTRIBUTE))) {
      if (!viewed.has(path)) {
        viewed.add(path);
        pendingViewed.push(path);
      }
    }
    maybeSendSoon();
  }

  function onScreenEnough(entry: IntersectionObserverEntry): boolean {
    if (!entry.isIntersecting) {
      return false;
    }
    return (
      entry.intersectionRatio >= 0.5 ||
      entry.intersectionRect.height >= 0.5 * innerHeight
    );
  }

  const intersections = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const element = entry.target;
        const timer = viewTimers.get(element);
        if (onScreenEnough(entry)) {
          if (timer === undefined) {
            viewTimers.set(
              element,
              setTimeout(() => {
                viewTimers.delete(element);
                if (
                  element.isConnected &&
                  document.visibilityState === "visible"
                ) {
                  countViewed(element);
                }
              }, viewedAfterMs),
            );
          }
        } else if (timer !== undefined) {
          clearTimeout(timer);
          viewTimers.delete(element);
        }
      }
    },
    { threshold: THRESHOLDS },
  );

  const observed = new Set<Element>();
  function scan() {
    document.querySelectorAll(SELECTOR).forEach((element) => {
      countRendered(element);
      if (!observed.has(element)) {
        observed.add(element);
        intersections.observe(element);
      }
    });
    for (const element of observed) {
      if (!element.isConnected) {
        observed.delete(element);
        intersections.unobserve(element);
      }
    }
    maybeSendSoon();
  }

  // Coalesced: a render that adds a hundred tagged elements is one scan.
  let scanQueued = false;
  function queueScan() {
    if (scanQueued) {
      return;
    }
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      if (!stopped) {
        scan();
      }
    }, 50);
  }
  const mutations = new MutationObserver(queueScan);

  function startPageView(first: boolean) {
    route = routeOf(location.pathname);
    view = pageView(first, location);
    viewSent = false;
    rendered.clear();
    viewed.clear();
    for (const timer of viewTimers.values()) {
      clearTimeout(timer);
    }
    viewTimers.clear();
    // Observe everything afresh, so what is already on screen reports itself
    // to the new page view.
    for (const element of observed) {
      intersections.unobserve(element);
    }
    observed.clear();
    firstSendTimer = setTimeout(() => {
      firstSendTimer = null;
      flushNow(false);
    }, firstSendAfterMs);
    queueScan();
  }

  function onLocationMaybeChanged() {
    if (stopped || routeOf(location.pathname) === route) {
      return;
    }
    flushNow(false);
    startPageView(false);
  }

  // Client-side navigation: the router calls `pushState`, and back and
  // forward fire `popstate`. A change of query or hash alone is not a new
  // page view.
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    onLocationMaybeChanged();
  };
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    onLocationMaybeChanged();
  };

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") {
      flushNow(true);
    }
  }
  function onPageHide() {
    flushNow(true);
  }
  function onPageShow(event: PageTransitionEvent) {
    // Back from the back/forward cache: the visitor is looking again.
    if (event.persisted) {
      startPageView(false);
    }
  }
  addEventListener("popstate", onLocationMaybeChanged);
  addEventListener("pagehide", onPageHide);
  addEventListener("pageshow", onPageShow);
  document.addEventListener("visibilitychange", onVisibilityChange);
  mutations.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [ATTRIBUTE],
  });

  /*
   * The page the visitor LANDED on, if it is not the one they are on now.
   *
   * This starts after hydration, from a lazily loaded chunk, and a visitor
   * can click through to another page before it does. That first page view
   * still happened, and it is the one with the referrer -- often the most
   * useful thing about a visit -- so it is sent on its own, with nothing
   * counted on it (nothing was being counted yet), and the page they are on
   * now starts as a navigation within the site.
   */
  const landing = landingUrl();
  if (landing && routeOf(landing.pathname) !== routeOf(location.pathname)) {
    for (const beacon of buildBeacons({
      route: routeOf(landing.pathname),
      cv: options.contentVersion,
      view: pageView(true, landing),
      rendered: [],
      viewed: [],
    })) {
      send(beacon, false);
    }
    startPageView(false);
  } else {
    startPageView(true);
  }

  function stop(sendFirst: boolean) {
    if (stopped) {
      return;
    }
    if (sendFirst) {
      flushNow(false);
    }
    stopped = true;
    if (firstSendTimer !== null) {
      clearTimeout(firstSendTimer);
    }
    if (batchTimer !== null) {
      clearTimeout(batchTimer);
    }
    for (const timer of viewTimers.values()) {
      clearTimeout(timer);
    }
    viewTimers.clear();
    mutations.disconnect();
    intersections.disconnect();
    // Only put them back if nothing has wrapped them since.
    if (history.pushState !== originalPushState) {
      history.pushState = originalPushState;
    }
    if (history.replaceState !== originalReplaceState) {
      history.replaceState = originalReplaceState;
    }
    removeEventListener("popstate", onLocationMaybeChanged);
    removeEventListener("pagehide", onPageHide);
    removeEventListener("pageshow", onPageShow);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  return {
    flush: () => {
      if (!stopped) {
        flushNow(false);
      }
    },
    stop: () => stop(true),
  };
}

/** The URL the document was loaded at, from the navigation timing entry. */
function landingUrl(): URL | null {
  if (typeof performance === "undefined" || !performance.getEntriesByType) {
    return null;
  }
  const [entry] = performance.getEntriesByType("navigation");
  if (!entry?.name) {
    return null;
  }
  try {
    return new URL(entry.name);
  } catch {
    return null;
  }
}
