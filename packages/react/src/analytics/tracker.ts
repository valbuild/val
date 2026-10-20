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
  /**
   * The pathname the page was rendered and hydrated at. When the visitor is
   * somewhere else by the time this starts, they navigated in between, and
   * that page is sent as a page view of its own. Without it, the URL the
   * document was loaded at stands in -- which also differs after a redirect
   * or a trailing slash the router normalised, so a caller that knows should
   * say.
   */
  landingPath?: string;
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
  /**
   * Whether a beacon has been sent with `fetch`, whose answer can be read --
   * one is, the first that is not sent while leaving, so a site with
   * analytics off or paused (410) stops sending.
   */
  let asked = false;

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
    if (!asked && !leaving) {
      asked = true;
      // `sendBeacon` cannot read the answer, so this one asks. Not while
      // leaving, where only `sendBeacon` is sure to get out -- the next one
      // asks instead.
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
    if (!leaving) {
      // The first beacon is as long as a navigation's old page gets: what is
      // still here by then is the new page's. Leaving before that, it is
      // not counted at all -- better than counted on the wrong route.
      confirmCarried();
    }
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

  /** Elements on screen enough to be viewed, whether or not they have been. */
  const onScreen = new Set<Element>();
  function armViewTimer(element: Element) {
    if (viewTimers.has(element) || document.visibilityState !== "visible") {
      return;
    }
    viewTimers.set(
      element,
      setTimeout(() => {
        viewTimers.delete(element);
        if (element.isConnected) {
          countViewed(element);
        }
      }, viewedAfterMs),
    );
  }
  function clearViewTimer(element: Element) {
    const timer = viewTimers.get(element);
    if (timer !== undefined) {
      clearTimeout(timer);
      viewTimers.delete(element);
    }
  }
  function clearViewTimers() {
    for (const timer of viewTimers.values()) {
      clearTimeout(timer);
    }
    viewTimers.clear();
  }

  const intersections = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (onScreenEnough(entry)) {
          onScreen.add(entry.target);
          armViewTimer(entry.target);
        } else {
          onScreen.delete(entry.target);
          clearViewTimer(entry.target);
        }
      }
    },
    { threshold: THRESHOLDS },
  );

  const observed = new Set<Element>();
  function forget(element: Element) {
    observed.delete(element);
    onScreen.delete(element);
    clearViewTimer(element);
    intersections.unobserve(element);
  }

  /*
   * After a client-side navigation the URL changes when it starts, and the
   * old page stays on screen until the new one has loaded -- often longer
   * than a scan takes to find it. So what is on the page when the URL
   * changes is CARRIED, and not counted for the new route until the page has
   * changed under it: some content of the new page is added, or some of the
   * carried content is removed. What is still there then is the layout
   * around both pages (a header, a footer), and it counts.
   */
  const carried = new Set<Element>();
  function confirmCarried() {
    if (carried.size === 0) {
      return;
    }
    const kept = [...carried];
    carried.clear();
    for (const element of kept) {
      if (element.isConnected) {
        track(element);
      }
    }
  }

  function track(element: Element) {
    if (carried.has(element)) {
      return;
    }
    countRendered(element);
    if (!observed.has(element)) {
      observed.add(element);
      intersections.observe(element);
    }
  }

  function scanAll() {
    document.querySelectorAll(SELECTOR).forEach(track);
    maybeSendSoon();
  }

  /*
   * What changed, a little later: a render that adds a hundred tagged
   * elements is one pass, and the pass looks at what was added rather than
   * at the whole document, so a page that changes all the time (a clock, a
   * carousel) costs what it changes.
   */
  const added = new Set<Element>();
  let removedSome = false;
  let processQueued = false;
  function process() {
    processQueued = false;
    if (stopped) {
      return;
    }
    let pageChanged = false;
    for (const root of added) {
      if (!root.isConnected) {
        continue;
      }
      const found = root.matches(SELECTOR) ? [root] : [];
      root.querySelectorAll(SELECTOR).forEach((element) => {
        found.push(element);
      });
      for (const element of found) {
        if (!carried.has(element)) {
          pageChanged = true;
          track(element);
        }
      }
    }
    added.clear();
    if (removedSome) {
      removedSome = false;
      for (const element of observed) {
        if (!element.isConnected) {
          forget(element);
        }
      }
      for (const element of carried) {
        if (!element.isConnected) {
          carried.delete(element);
          pageChanged = true;
        }
      }
    }
    if (pageChanged) {
      confirmCarried();
    }
    maybeSendSoon();
  }
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target instanceof Element) {
          added.add(record.target);
        }
        continue;
      }
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) {
          added.add(node);
        }
      });
      if (record.removedNodes.length > 0) {
        removedSome = true;
      }
    }
    if (!processQueued && (added.size > 0 || removedSome)) {
      processQueued = true;
      setTimeout(process, 50);
    }
  });

  /**
   * A new page view. `carry` for a client-side navigation, whose old page is
   * probably still on screen; see `carried`.
   */
  function startPageView(first: boolean, url: URL | Location, carry: boolean) {
    route = routeOf(location.pathname);
    view = pageView(first, url);
    viewSent = false;
    rendered.clear();
    viewed.clear();
    clearViewTimers();
    // Observe everything afresh, so what is already on screen reports itself
    // to the new page view.
    for (const element of [...observed]) {
      forget(element);
    }
    carried.clear();
    if (carry) {
      document.querySelectorAll(SELECTOR).forEach((element) => {
        carried.add(element);
      });
    }
    firstSendTimer = setTimeout(() => {
      firstSendTimer = null;
      flushNow(false);
    }, firstSendAfterMs);
    scanAll();
  }

  function onLocationMaybeChanged() {
    if (stopped || routeOf(location.pathname) === route) {
      return;
    }
    flushNow(false);
    startPageView(false, location, true);
  }

  // Client-side navigation: the router calls `pushState`, and back and
  // forward fire `popstate`. A change of query or hash alone is not a new
  // page view.
  //
  // Applied to `history`, never to `this`: a router may call the function
  // it took off `history` unbound (TanStack's does), and the browser's own
  // throws "Illegal invocation" without its object.
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  const pushState: History["pushState"] = (...args) => {
    originalPushState.apply(history, args);
    onLocationMaybeChanged();
  };
  const replaceState: History["replaceState"] = (...args) => {
    originalReplaceState.apply(history, args);
    onLocationMaybeChanged();
  };
  history.pushState = pushState;
  history.replaceState = replaceState;

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") {
      // Time hidden is not time looked at: what was on its way to viewed
      // starts again when the visitor is back.
      clearViewTimers();
      flushNow(true);
    } else if (document.visibilityState === "visible") {
      // The observer reports nothing new when only the tab changed, so what
      // is on screen is armed again from what it last said.
      for (const element of onScreen) {
        armViewTimer(element);
      }
    }
  }
  function onPageHide() {
    flushNow(true);
  }
  function onPageShow(event: PageTransitionEvent) {
    // Back from the back/forward cache: the visitor is looking again.
    if (event.persisted) {
      startPageView(false, location, false);
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
  const landedAt = options.landingPath ?? landing?.pathname;
  // The campaign is in the URL the visitor arrived at; a redirect or the
  // router may have dropped the query since.
  const arrivedAt = landing && !utmOf(location.search) ? landing : location;
  if (
    landedAt !== undefined &&
    routeOf(landedAt) !== routeOf(location.pathname)
  ) {
    for (const beacon of buildBeacons({
      route: routeOf(landedAt),
      cv: options.contentVersion,
      view: pageView(true, arrivedAt),
      rendered: [],
      viewed: [],
    })) {
      send(beacon, false);
    }
    startPageView(false, location, false);
  } else {
    startPageView(true, arrivedAt, false);
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
    clearViewTimers();
    mutations.disconnect();
    intersections.disconnect();
    // Only put them back if nothing has wrapped them since: restoring over a
    // later wrapper would take it off, and whatever installed it would stop
    // seeing navigations.
    if (history.pushState === pushState) {
      history.pushState = originalPushState;
    }
    if (history.replaceState === replaceState) {
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
