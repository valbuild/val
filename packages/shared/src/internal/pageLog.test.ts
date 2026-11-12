/**
 * @jest-environment jsdom
 */
import {
  countEntries,
  formatConsoleArgs,
  installPageLog,
  installPageLogInCanvasFrame,
  PAGE_LOG_TEXT_LENGTH,
  pageLogOf,
  type PageLog,
} from "./pageLog";

/**
 * The page's log: what the assistant reads with `read_page_log`, one source
 * of trouble at a time, and the rules that keep it from changing the page.
 */
describe("the page log", () => {
  let log: PageLog | null = null;
  /** What the page's own console was handed. */
  let printedErrors: unknown[][];
  let printedWarnings: unknown[][];
  const originalError = console.error;
  const originalWarn = console.warn;

  beforeEach(() => {
    printedErrors = [];
    printedWarnings = [];
    // The page's console before Val came: it must still be called, as is.
    console.error = (...args: unknown[]) => void printedErrors.push(args);
    console.warn = (...args: unknown[]) => void printedWarnings.push(args);
    window.history.replaceState(null, "", "/about");
    document.body.innerHTML = "";
  });

  afterEach(() => {
    log?.uninstall();
    log = null;
    console.error = originalError;
    console.warn = originalWarn;
    Reflect.deleteProperty(window, "fetch");
  });

  const install = (options?: Parameters<typeof installPageLog>[1]) => {
    log = installPageLog(window, options);
    return log;
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  describe("console", () => {
    it("records console.error, and the page's console still prints it", () => {
      const pageLog = install();
      console.error("Could not render %s", "Hero", { id: 3 });
      expect(printedErrors).toEqual([
        ["Could not render %s", "Hero", { id: 3 }],
      ]);
      expect(pageLog.read().entries).toMatchObject([
        {
          level: "error",
          source: "console",
          text: 'Could not render Hero {"id":3}',
          path: "/about",
        },
      ]);
    });

    it("records console.warn as a warning", () => {
      const pageLog = install();
      console.warn("Deprecated prop");
      expect(printedWarnings).toEqual([["Deprecated prop"]]);
      expect(pageLog.read().entries).toMatchObject([
        { level: "warn", source: "console", text: "Deprecated prop" },
      ]);
    });

    it("leaves Val's own lines out", () => {
      const pageLog = install();
      console.error("[val]", "something of Val's");
      expect(printedErrors).toHaveLength(1);
      expect(pageLog.read().entries).toEqual([]);
    });

    it("counts a line repeated in a row once, with how many times", () => {
      const pageLog = install();
      for (let i = 0; i < 5; i++) console.error("Too many re-renders");
      expect(pageLog.read().entries).toMatchObject([
        { text: "Too many re-renders", repeated: 5 },
      ]);
      expect(pageLog.counts().errors).toBe(5);
    });

    it("puts the page's console back when uninstalled", () => {
      const before = console.error;
      install().uninstall();
      expect(console.error).toBe(before);
    });
  });

  it("records an uncaught exception, with the top of its stack", () => {
    const pageLog = install();
    const error = new TypeError("Cannot read properties of undefined");
    error.stack = `TypeError: Cannot read properties of undefined\n    at Hero (/src/Hero.tsx:12:5)\n    at renderWithHooks (react-dom.js:1:1)`;
    // jest's jsdom rethrows a window `error` that no test listener took.
    const handled = (event: Event) => event.preventDefault();
    window.addEventListener("error", handled);
    window.dispatchEvent(
      new ErrorEvent("error", { message: error.message, error }),
    );
    window.removeEventListener("error", handled);
    expect(pageLog.read().entries).toMatchObject([
      {
        level: "error",
        source: "exception",
        text: "TypeError: Cannot read properties of undefined\nat Hero (/src/Hero.tsx:12:5)\nat renderWithHooks (react-dom.js:1:1)",
      },
    ]);
  });

  it("records a rejected promise nobody handled", () => {
    const pageLog = install();
    // jsdom has no PromiseRejectionEvent: the event as the browser shapes it.
    const event = new Event("unhandledrejection");
    Reflect.set(event, "reason", new Error("Network down"));
    window.dispatchEvent(event);
    expect(pageLog.read().entries).toMatchObject([
      {
        level: "error",
        source: "rejection",
        text: expect.stringMatching(
          /^Unhandled rejection: Error: Network down\n\s*at /,
        ),
      },
    ]);
  });

  it("records an image that did not load", () => {
    const pageLog = install();
    const img = document.createElement("img");
    img.setAttribute("src", "/missing.jpg");
    document.body.appendChild(img);
    // An element's `error` does not bubble: only a capture listener hears it.
    img.dispatchEvent(new Event("error"));
    expect(pageLog.read().entries).toMatchObject([
      {
        level: "error",
        source: "resource",
        tag: "img",
        url: "http://localhost/missing.jpg",
      },
    ]);
    expect(pageLog.counts()).toEqual({
      errors: 0,
      warnings: 0,
      failedRequests: 1,
    });
  });

  it("records a stylesheet that did not load", () => {
    const pageLog = install();
    const link = document.createElement("link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", "/styles.css");
    document.head.appendChild(link);
    link.dispatchEvent(new Event("error"));
    link.remove();
    expect(pageLog.read().entries).toMatchObject([
      { source: "resource", tag: "link", url: "http://localhost/styles.css" },
    ]);
  });

  describe("fetch", () => {
    const respond = (status: number) =>
      // What the page reads of a response; jsdom has no `Response`.
      jest.fn(() => Promise.resolve({ status, statusText: "" }));

    it("records a request that answered 400 or more", async () => {
      Reflect.set(window, "fetch", respond(500));
      const pageLog = install();
      await window.fetch("/api/products", { method: "post" });
      await flush();
      expect(pageLog.read().entries).toMatchObject([
        {
          level: "error",
          source: "request",
          status: 500,
          url: "http://localhost/api/products",
          text: "POST http://localhost/api/products answered 500",
        },
      ]);
    });

    it("records a request that failed, and hands the page the same failure", async () => {
      const failure = new TypeError("Failed to fetch");
      Reflect.set(
        window,
        "fetch",
        jest.fn(() => Promise.reject(failure)),
      );
      const pageLog = install();
      await expect(window.fetch("https://cdn.example/x.json")).rejects.toBe(
        failure,
      );
      await flush();
      expect(pageLog.read().entries).toMatchObject([
        {
          source: "request",
          url: "https://cdn.example/x.json",
          text: expect.stringMatching(
            /^GET https:\/\/cdn\.example\/x\.json failed: TypeError: Failed to fetch/,
          ),
        },
      ]);
    });

    it("hands the page the response it got, and leaves a good one out", async () => {
      const fetch = respond(200);
      Reflect.set(window, "fetch", fetch);
      const pageLog = install();
      const response = await window.fetch("/api/products");
      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledWith("/api/products", undefined);
      await flush();
      expect(pageLog.read().entries).toEqual([]);
    });

    it("leaves Val's own API out", async () => {
      Reflect.set(window, "fetch", respond(401));
      const pageLog = install();
      await window.fetch("/api/val/draft/stat");
      await flush();
      expect(pageLog.read().entries).toEqual([]);
    });

    it("leaves an abort out: the page changed its mind", async () => {
      const abort = new Error("aborted");
      abort.name = "AbortError";
      Reflect.set(
        window,
        "fetch",
        jest.fn(() => Promise.reject(abort)),
      );
      const pageLog = install();
      await expect(window.fetch("/api/search")).rejects.toBe(abort);
      await flush();
      expect(pageLog.read().entries).toEqual([]);
    });
  });

  it("finds an image that was already broken when it started", () => {
    const img = document.createElement("img");
    img.setAttribute("src", "/before.jpg");
    // jsdom loads nothing: an image that finished with no pixels.
    Object.defineProperty(img, "complete", { value: true });
    document.body.appendChild(img);
    const pageLog = install();
    expect(pageLog.read().entries).toMatchObject([
      { source: "resource", tag: "img", url: "http://localhost/before.jpg" },
    ]);
  });

  describe("navigation", () => {
    it("reads only what happened since the page navigated, unless asked", () => {
      const pageLog = install();
      console.error("on the first page");
      window.history.pushState(null, "", "/contact");
      console.error("on the second page");
      expect(pageLog.read().entries.map((entry) => entry.text)).toEqual([
        "on the second page",
      ]);
      expect(
        pageLog
          .read({ sinceNavigation: false })
          .entries.map((entry) => [entry.path, entry.text]),
      ).toEqual([
        ["/about", "on the first page"],
        ["/contact", "on the second page"],
      ]);
      expect(pageLog.counts().errors).toBe(1);
    });

    it("starts a new page when it is read after a quiet navigation", () => {
      const pageLog = install();
      console.error("on the first page");
      window.history.pushState(null, "", "/contact");
      expect(pageLog.read().entries).toEqual([]);
      expect(pageLog.read().path).toBe("/contact");
    });
  });

  it("filters by level", () => {
    const pageLog = install();
    console.error("broken");
    console.warn("deprecated");
    expect(
      pageLog.read({ levels: ["warn"] }).entries.map((entry) => entry.text),
    ).toEqual(["deprecated"]);
  });

  it("keeps the newest entries, and says how many it dropped", () => {
    const pageLog = install({ size: 3 });
    for (let i = 1; i <= 5; i++) console.error(`error ${i}`);
    const read = pageLog.read();
    expect(read.entries.map((entry) => entry.text)).toEqual([
      "error 3",
      "error 4",
      "error 5",
    ]);
    expect(read.dropped).toBe(2);
  });

  it("shortens long text", () => {
    const pageLog = install();
    console.error("x".repeat(PAGE_LOG_TEXT_LENGTH * 2));
    expect(pageLog.read().entries[0].text).toHaveLength(PAGE_LOG_TEXT_LENGTH);
  });

  it("is installed once per window", () => {
    const first = install();
    expect(installPageLog(window)).toBe(first);
    expect(pageLogOf(window)).toBe(first);
    console.error("once");
    expect(first.read().entries).toHaveLength(1);
  });

  it("is not installed in a page that is not the Studio's canvas", () => {
    window.history.replaceState(null, "", "/about");
    expect(installPageLogInCanvasFrame()).toBeNull();
    expect(pageLogOf(window)).toBeNull();
  });

  it("is installed in the Studio's canvas", () => {
    window.history.replaceState(null, "", "/about?val_canvas=1");
    log = installPageLogInCanvasFrame();
    expect(log).not.toBeNull();
    expect(pageLogOf(window)).toBe(log);
  });
});

describe("formatConsoleArgs", () => {
  it("applies substitutions the way the console does, and drops styles", () => {
    expect(formatConsoleArgs(["%cVal%c ready", "color: red", ""])).toBe(
      "Val ready",
    );
    expect(formatConsoleArgs(["%d items, %s", 3.7, "done", "extra"])).toBe(
      "3 items, done extra",
    );
  });

  it("names an error with its message", () => {
    expect(formatConsoleArgs([new RangeError("Too far")])).toMatch(
      /^RangeError: Too far/,
    );
  });
});

describe("countEntries", () => {
  it("counts errors, warnings and failed requests apart", () => {
    expect(
      countEntries([
        { level: "error", source: "console", text: "a", path: "/", at: 0 },
        { level: "error", source: "exception", text: "b", path: "/", at: 0 },
        { level: "warn", source: "console", text: "c", path: "/", at: 0 },
        {
          level: "error",
          source: "request",
          text: "d",
          path: "/",
          at: 0,
          repeated: 2,
        },
      ]),
    ).toEqual({ errors: 2, warnings: 1, failedRequests: 2 });
  });
});
