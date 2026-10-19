/** @jest-environment jsdom */
import type { AnalyticsBeacon } from "./beacon";
import { startValAnalytics, type ValAnalytics } from "./tracker";

/**
 * jsdom has no layout, so it has no IntersectionObserver. This one does what a
 * browser's does for the tracker -- one callback per element when it starts
 * being observed -- and lets a test say what is on screen.
 */
class FakeIntersectionObserver implements IntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds: readonly number[] = [];
  readonly observed = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
    this.report(element, onScreen.has(element));
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.observed.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  report(element: Element, visible: boolean) {
    const entry: IntersectionObserverEntry = {
      target: element,
      time: 0,
      rootBounds: null,
      isIntersecting: visible,
      intersectionRatio: visible ? 1 : 0,
      boundingClientRect: rect(100),
      intersectionRect: rect(visible ? 100 : 0),
    };
    this.callback([entry], this);
  }
}

function rect(height: number): DOMRectReadOnly {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    width: 100,
    right: 100,
    height,
    bottom: height,
    toJSON: () => ({}),
  };
}

const onScreen = new Set<Element>();
function setOnScreen(element: Element, visible: boolean) {
  if (visible) {
    onScreen.add(element);
  } else {
    onScreen.delete(element);
  }
  for (const observer of FakeIntersectionObserver.instances) {
    if (observer.observed.has(element)) {
      observer.report(element, visible);
    }
  }
}

let fetched: { body: AnalyticsBeacon; status: number }[];
let beaconed: AnalyticsBeacon[];
let fetchStatus: number;
let tracker: ValAnalytics | null;

function sent(): AnalyticsBeacon[] {
  return [...fetched.map((f) => f.body), ...beaconed];
}

function tagged(path: string, text = "x"): HTMLElement {
  const element = document.createElement("p");
  element.setAttribute("data-val-path", path);
  element.textContent = text;
  document.body.appendChild(element);
  return element;
}

async function settle(ms: number) {
  await jest.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = "";
  onScreen.clear();
  FakeIntersectionObserver.instances = [];
  Reflect.set(window, "IntersectionObserver", FakeIntersectionObserver);
  fetched = [];
  beaconed = [];
  fetchStatus = 200;
  Reflect.set(
    window,
    "fetch",
    jest.fn(async (_url: string, init: { body: string }) => {
      fetched.push({ body: JSON.parse(init.body), status: fetchStatus });
      return { status: fetchStatus };
    }),
  );
  Reflect.set(navigator, "sendBeacon", (_url: string, body: string) => {
    beaconed.push(JSON.parse(body));
    return true;
  });
  history.replaceState(null, "", "/blogs/a");
  tracker = null;
});

afterEach(() => {
  tracker?.stop();
  jest.useRealTimers();
});

test("sends the page view with what was rendered, about 3 s after load", async () => {
  tagged('/content/blog.val.ts?p="a"."title"');
  tagged('/content/blog.val.ts?p="a"."body",/content/footer.val.ts');
  tracker = startValAnalytics();
  await settle(2_000);
  expect(sent()).toEqual([]);
  await settle(1_500);
  expect(sent()).toEqual([
    {
      v: 1,
      route: "/blogs/a",
      view: { device: "desktop" },
      rendered: {
        "/content/blog.val.ts": ['"a"."title"', '"a"."body"'],
        "/content/footer.val.ts": [""],
      },
      viewed: {},
    },
  ]);
  // The first beacon is sent with fetch, so its answer can be read.
  expect(fetched).toHaveLength(1);
});

test("counts an element as viewed after 1 s on screen, and not before", async () => {
  const title = tagged('/content/blog.val.ts?p="a"."title"');
  const body = tagged('/content/blog.val.ts?p="a"."body"');
  const running = startValAnalytics();
  tracker = running;
  await settle(100);
  setOnScreen(title, true);
  setOnScreen(body, true);
  await settle(500);
  setOnScreen(body, false); // scrolled past before the second was up
  await settle(600);
  running?.flush();
  const viewed = sent().flatMap((b) => b.viewed["/content/blog.val.ts"] ?? []);
  expect(viewed).toEqual(['"a"."title"']);
});

test("counts each path at most once per page view", async () => {
  const title = tagged('/content/blog.val.ts?p="a"."title"');
  tagged('/content/blog.val.ts?p="a"."title"'); // the same content twice
  const running = startValAnalytics();
  tracker = running;
  await settle(100);
  setOnScreen(title, true);
  await settle(1_100);
  setOnScreen(title, false);
  setOnScreen(title, true);
  await settle(1_100);
  await settle(3_000);
  running?.flush();
  const all = sent();
  const rendered = all.flatMap((b) => b.rendered["/content/blog.val.ts"] ?? []);
  const viewed = all.flatMap((b) => b.viewed["/content/blog.val.ts"] ?? []);
  expect(rendered).toEqual(['"a"."title"']);
  expect(viewed).toEqual(['"a"."title"']);
});

test("content added later is counted, and goes with the next beacon", async () => {
  tracker = startValAnalytics();
  await settle(3_100);
  tagged('/content/lazy.val.ts?p="late"');
  await settle(100);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
  Reflect.deleteProperty(document, "visibilityState");
  // Leaving the page goes by sendBeacon, which survives it.
  expect(beaconed[beaconed.length - 1]?.rendered).toEqual({
    "/content/lazy.val.ts": ['"late"'],
  });
  expect(beaconed[beaconed.length - 1]?.view).toBeUndefined();
});

test("a client-side navigation ends one page view and starts the next", async () => {
  const header = tagged("/content/header.val.ts");
  tracker = startValAnalytics();
  await settle(3_100);
  history.pushState(null, "", "/blogs/b");
  await settle(100);
  setOnScreen(header, true);
  await settle(1_100);
  await settle(3_000);
  const second = sent().filter((b) => b.route === "/blogs/b");
  expect(second[0].view).toEqual({ device: "desktop" });
  // Still on screen, so rendered (and viewed) again for the new page view.
  expect(
    second.flatMap((b) => b.rendered["/content/header.val.ts"] ?? []),
  ).toEqual([""]);
  expect(
    second.flatMap((b) => b.viewed["/content/header.val.ts"] ?? []),
  ).toEqual([""]);
});

test("a change of query alone is not a new page view", async () => {
  tagged("/content/header.val.ts");
  tracker = startValAnalytics();
  await settle(3_100);
  history.pushState(null, "", "/blogs/a?tab=2");
  await settle(5_000);
  expect(sent().filter((b) => b.view)).toHaveLength(1);
});

test("stops when the site answers 410", async () => {
  fetchStatus = 410;
  const title = tagged('/content/blog.val.ts?p="a"."title"');
  tracker = startValAnalytics();
  await settle(3_100);
  expect(fetched).toHaveLength(1);
  setOnScreen(title, true);
  await settle(1_100);
  history.pushState(null, "", "/blogs/c");
  await settle(5_000);
  expect(sent()).toHaveLength(1);
});

test("restores history when stopped", () => {
  const pushState = history.pushState;
  tracker = startValAnalytics();
  expect(history.pushState).not.toBe(pushState);
  tracker?.stop();
  tracker = null;
  expect(history.pushState).toBe(pushState);
});

test("does nothing in an automated browser", () => {
  Object.defineProperty(navigator, "webdriver", {
    configurable: true,
    get: () => true,
  });
  try {
    expect(startValAnalytics()).toBeNull();
  } finally {
    Reflect.deleteProperty(navigator, "webdriver");
  }
});
