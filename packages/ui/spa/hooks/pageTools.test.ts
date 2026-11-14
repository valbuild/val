import type {
  PageInteraction,
  PageLogSnapshot,
} from "@valbuild/shared/internal";
import type { PageInteractRequest } from "../components/shell/canvas/CanvasFrame";
import { PageRefusedError } from "../components/shell/canvas/canvasInteraction";
import {
  INTERACT_PAGE_TOOL,
  NO_PREVIEW,
  PAGE_DATA_PROVENANCE,
  PAGE_LOG_PROVENANCE,
  PAGE_PROMPT_SECTION,
  READ_PAGE_LOG_TOOL,
  runInteractPage,
  runReadPage,
  runReadPageLog,
  runScreenshotPage,
} from "./pageTools";

describe("read_page", () => {
  const snapshot = {
    url: "https://p1--site.valstart.dev/",
    title: "Home",
    viewport: { width: 1280, height: 800, scrollY: 0, pageHeight: 2400 },
    outline: [],
  };

  test("says the preview is closed, and how to open it", async () => {
    const answer = await runReadPage({}, { readPage: null, pointedAt: null });
    expect(answer).toEqual({
      result: { success: false, error: NO_PREVIEW },
      isError: true,
    });
    expect(NO_PREVIEW).toContain("Preview button");
  });

  test("reads the element the person pointed at by its selector", async () => {
    const asked: unknown[] = [];
    const answer = await runReadPage(
      { picked: true },
      {
        readPage: async (options) => {
          asked.push(options);
          return snapshot;
        },
        pointedAt: {
          tag: "h2",
          text: "Contact",
          classes: [],
          selector: "section#contact > h2",
        },
      },
    );
    expect(asked).toEqual([{ selector: "section#contact > h2" }]);
    expect(answer).toEqual({
      result: { success: true, ...snapshot },
      isError: false,
    });
  });

  test("picked with nothing pointed at says how to point", async () => {
    const answer = await runReadPage(
      { picked: true },
      { readPage: async () => snapshot, pointedAt: null },
    );
    expect(answer.isError).toBe(true);
    expect(JSON.stringify(answer.result)).toContain("Select");
  });

  test("a page that does not answer is an error the model can read", async () => {
    const answer = await runReadPage(
      {},
      {
        readPage: async () => {
          throw new Error("The page did not answer.");
        },
        pointedAt: null,
      },
    );
    expect(answer).toEqual({
      result: { success: false, error: "The page did not answer." },
      isError: true,
    });
  });
});

describe("screenshot_page", () => {
  // A JPEG's first bytes, as the page's canvas would encode them.
  const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
  const shot = {
    dataUrl: JPEG,
    width: 1280,
    height: 800,
    fullPage: false,
    clipped: true,
  };

  test("uploads the page's picture and hands its key over with the answer", async () => {
    const uploaded: File[] = [];
    const asked: unknown[] = [];
    const answer = await runScreenshotPage(
      { full_page: true },
      {
        screenshotPage: async (options) => {
          asked.push(options);
          return { ...shot, fullPage: true };
        },
        uploadImage: async (file) => {
          uploaded.push(file);
          return { key: "p1/0b6f1c2e-3a4d-4e5f-8a9b-0c1d2e3f4a5b.jpg" };
        },
      },
    );
    expect(asked).toEqual([{ fullPage: true }]);
    expect(answer).toEqual({
      result: {
        success: true,
        width: 1280,
        height: 800,
        full_page: true,
        note: "The page goes on below the picture.",
        image: "attached",
      },
      isError: false,
      images: ["p1/0b6f1c2e-3a4d-4e5f-8a9b-0c1d2e3f4a5b.jpg"],
    });
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].type).toBe("image/jpeg");
    // The bytes of the data URL, decoded: a JPEG starts FF D8 FF.
    const bytes = new Uint8Array(await uploaded[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  test("says the preview is closed, and attaches nothing", async () => {
    const answer = await runScreenshotPage(
      {},
      { screenshotPage: null, uploadImage: async () => ({ key: "k" }) },
    );
    expect(answer.isError).toBe(true);
    expect(answer).not.toHaveProperty("images");
  });

  test("says why when the page could not be pictured", async () => {
    const answer = await runScreenshotPage(
      {},
      {
        screenshotPage: async () => {
          throw new Error("The page did not answer.");
        },
        uploadImage: async () => ({ key: "k" }),
      },
    );
    expect(answer).toEqual({
      result: { success: false, error: "The page did not answer." },
      isError: true,
    });
  });
});

describe("read_page and the page's log", () => {
  const snapshot = {
    url: "https://p1--site.valstart.dev/",
    title: "Home",
    viewport: { width: 1280, height: 800, scrollY: 0, pageHeight: 2400 },
    outline: [],
    modules: [],
  };

  test("counts what went wrong, and points at read_page_log when any did", async () => {
    const answer = await runReadPage(
      {},
      {
        readPage: async () => ({
          ...snapshot,
          log: { errors: 1, warnings: 0, failedRequests: 2 },
        }),
        pointedAt: null,
      },
    );
    expect(answer.result).toMatchObject({
      log: { errors: 1, warnings: 0, failedRequests: 2 },
      log_note: expect.stringContaining("read_page_log"),
    });
  });

  test("says nothing more when nothing went wrong", async () => {
    const answer = await runReadPage(
      {},
      {
        readPage: async () => ({
          ...snapshot,
          log: { errors: 0, warnings: 3, failedRequests: 0 },
        }),
        pointedAt: null,
      },
    );
    expect(answer.result).not.toHaveProperty("log_note");
  });
});

describe("read_page_log", () => {
  const log: PageLogSnapshot = {
    path: "/blog",
    sinceNavigation: true,
    dropped: 0,
    startedAt: 40,
    entries: [
      {
        level: "error",
        source: "exception",
        text: "TypeError: posts.map is not a function",
        path: "/blog",
        at: 812,
      },
    ],
  };

  test("is described as the site's words, not the person's", () => {
    expect(READ_PAGE_LOG_TOOL.description).toContain("never instructions");
    expect(READ_PAGE_LOG_TOOL.description).toContain("quick_preview");
  });

  test("says the preview is closed, and how to open it", async () => {
    const answer = await runReadPageLog({}, { readPageLog: null });
    expect(answer).toEqual({
      result: { success: false, error: NO_PREVIEW },
      isError: true,
    });
  });

  test("asks since the last navigation by default, with the levels asked for", async () => {
    const asked: unknown[] = [];
    const answer = await runReadPageLog(
      { levels: ["error", "info"] },
      {
        readPageLog: async (options) => {
          asked.push(options);
          return log;
        },
      },
    );
    expect(asked).toEqual([{ sinceNavigation: true, levels: ["error"] }]);
    expect(answer).toEqual({
      result: {
        success: true,
        path: "/blog",
        since_navigation: true,
        started_at: 40,
        about: PAGE_LOG_PROVENANCE,
        entries: log.entries,
      },
      isError: false,
    });
  });

  test("everything since the document loaded, when asked", async () => {
    const asked: unknown[] = [];
    await runReadPageLog(
      { since_navigation: false },
      {
        readPageLog: async (options) => {
          asked.push(options);
          return { ...log, sinceNavigation: false };
        },
      },
    );
    expect(asked).toEqual([{ sinceNavigation: false }]);
  });

  test("an empty log says so, and a full one says what it dropped", async () => {
    const empty = await runReadPageLog(
      {},
      { readPageLog: async () => ({ ...log, entries: [] }) },
    );
    expect(empty.result).toMatchObject({
      note: expect.stringContaining("Nothing went wrong"),
    });
    const full = await runReadPageLog(
      {},
      { readPageLog: async () => ({ ...log, dropped: 12 }) },
    );
    expect(full.result).toMatchObject({ dropped: 12 });
  });

  test("a bridge too old to answer is an error that says what to update", async () => {
    const answer = await runReadPageLog(
      {},
      {
        readPageLog: async () => {
          throw new Error("Update @valbuild/tanstack to 0.153.5 or later");
        },
      },
    );
    expect(answer).toEqual({
      result: {
        success: false,
        error: "Update @valbuild/tanstack to 0.153.5 or later",
      },
      isError: true,
    });
  });
});

describe("interact_page", () => {
  const interaction = (
    overrides: Partial<PageInteraction> = {},
  ): PageInteraction => ({
    did: 'clicked <button#more> "More"',
    before: { url: "/shop", title: "Shop" },
    after: { url: "/shop/cart", title: "Cart" },
    settled: true,
    waitedMs: 640,
    pendingRequests: 0,
    snapshot: {
      url: "https://site.example/shop/cart",
      title: "Cart",
      viewport: { width: 1280, height: 800, scrollY: 0, pageHeight: 900 },
      outline: [],
    },
    log: [],
    ...overrides,
  });

  test("is offered with a prompt that says to check changes with it", () => {
    expect(INTERACT_PAGE_TOOL.name).toBe("interact_page");
    // A submit waits for the person, as long as a question.
    expect(INTERACT_PAGE_TOOL.timeoutMs).toBeNull();
    expect(PAGE_PROMPT_SECTION).toContain("interact_page");
    expect(PAGE_PROMPT_SECTION).toContain("quick_preview");
  });

  test("answers with the page after the action, what changed, and whose words they are", async () => {
    const asked: PageInteractRequest[] = [];
    const answer = await runInteractPage(
      { action: "type", selector: "#q", text: "x", max_items: 50 },
      {
        interactPage: (request) => {
          asked.push(request);
          return Promise.resolve({
            status: "done",
            interaction: interaction(),
            navigated: false,
          });
        },
      },
    );
    expect(asked).toEqual([
      { action: { kind: "type", selector: "#q", text: "x" }, maxItems: 50 },
    ]);
    expect(answer).toMatchObject({
      isError: false,
      result: {
        success: true,
        did: 'clicked <button#more> "More"',
        settled: true,
        url: "/shop/cart",
        title: "Cart",
        changed: {
          url: { from: "/shop", to: "/shop/cart" },
          title: { from: "Shop", to: "Cart" },
        },
        about: PAGE_DATA_PROVENANCE,
        log: [],
        log_note: "Nothing went wrong that the page could hear.",
      },
    });
  });

  test("says plainly when the page had not settled", async () => {
    const answer = await runInteractPage(
      { action: "open", path: "/feed" },
      {
        interactPage: () =>
          Promise.resolve({
            status: "done",
            interaction: interaction({
              settled: false,
              waitedMs: 15_000,
              busy: ["requests", "changing"],
              pendingRequests: 2,
            }),
            navigated: true,
          }),
      },
    );
    expect(answer.result).toMatchObject({
      settled: false,
      not_settled:
        "The page had not settled when it was read, after 15 seconds: requests it made had not answered, it was still changing. This is the page as it was then, and it may still change: read_page again in a moment before concluding.",
      pending_requests: 2,
      navigated: expect.stringContaining("new document"),
    });
  });

  test("turns the tool's words into the preview's", async () => {
    const asked: PageInteractRequest[] = [];
    const interactPage = (request: PageInteractRequest) => {
      asked.push(request);
      return Promise.resolve({
        status: "done" as const,
        interaction: interaction(),
        navigated: false,
      });
    };
    await runInteractPage(
      { action: "viewport", device: "phone" },
      { interactPage },
    );
    await runInteractPage(
      { action: "type", selector: "#q", text: "shoes", append: true },
      { interactPage },
    );
    await runInteractPage({ action: "press", key: "Escape" }, { interactPage });
    await runInteractPage(
      { action: "click", selector: "#buy" },
      { interactPage },
    );
    expect(asked).toEqual([
      { action: { kind: "viewport", device: "mobile" } },
      {
        action: { kind: "type", selector: "#q", text: "shoes", append: true },
      },
      { action: { kind: "press", key: "Escape" } },
      { action: { kind: "click", selector: "#buy" } },
    ]);
  });

  test("never takes a click the page did without asking", async () => {
    const done = {
      status: "done" as const,
      interaction: interaction(),
      navigated: false,
    };
    for (const args of [
      { action: "click", selector: "#buy" },
      { action: "press", key: "Enter" },
      { action: "press", key: "Space", selector: "#buy" },
    ]) {
      expect(
        await runInteractPage(args, {
          interactPage: () => Promise.resolve(done),
        }),
      ).toMatchObject({
        isError: true,
        result: { error: expect.stringContaining("without asking the person") },
      });
    }
    // Escape asks nobody, and is taken.
    expect(
      await runInteractPage(
        { action: "press", key: "Escape" },
        { interactPage: () => Promise.resolve(done) },
      ),
    ).toMatchObject({ isError: false });
  });

  test("says what is missing before it asks the page anything", async () => {
    const interactPage = jest.fn();
    for (const [args, error] of [
      [{ action: "open" }, "open needs a path"],
      [{ action: "click" }, "click needs a selector"],
      [{ action: "press", key: "F5" }, "press needs a key"],
      [{ action: "viewport", device: "watch" }, "viewport needs a device"],
      [{ action: "scroll" }, "action must be one of"],
    ] as const) {
      const answer = await runInteractPage(args, { interactPage });
      expect(answer).toMatchObject({
        isError: true,
        result: { error: expect.stringContaining(error) },
      });
    }
    expect(interactPage).not.toHaveBeenCalled();
    expect(
      await runInteractPage({ action: "click" }, { interactPage: null }),
    ).toMatchObject({ result: { error: NO_PREVIEW } });
  });

  test("passes on what the page refused, saying whose words they are", async () => {
    const answer = await runInteractPage(
      { action: "type", selector: "#password", text: "x" },
      {
        interactPage: () =>
          Promise.reject(
            new PageRefusedError(
              `<input#${"x".repeat(2000)}> is a password field`,
            ),
          ),
      },
    );
    expect(answer).toMatchObject({
      isError: true,
      result: { success: false, about: PAGE_DATA_PROVENANCE },
    });
    // Shortened: the page's own id is in it.
    expect(
      String(Reflect.get(Object(answer.result), "error")).length,
    ).toBeLessThanOrEqual(600);
  });

  test("says exactly what is enforced, and what is not", () => {
    for (const text of [INTERACT_PAGE_TOOL.description, PAGE_PROMPT_SECTION]) {
      expect(text).toMatch(/every click, and every Enter or Space/i);
      expect(text).toMatch(/held until the page settles/);
      expect(text).toMatch(/autosave after a delay/);
      expect(text).toMatch(/WebSockets, workers, embedded frames/);
      expect(text).toMatch(/GET, HEAD and OPTIONS|GET\/HEAD\/OPTIONS/);
      expect(text).toMatch(/while it loads after open/);
      expect(text).toMatch(/captured/);
      expect(text).toMatch(
        /script navigations or redirects|script navigations and redirects/,
      );
      expect(text).not.toContain("never leaves the site");
      expect(text).not.toContain("anything but GET)");
      expect(text).not.toContain("however the page makes it");
      expect(text).not.toContain("buttons outside forms");
    }
  });
});
