import type { PageLogSnapshot } from "@valbuild/shared/internal";
import {
  NO_PREVIEW,
  PAGE_LOG_PROVENANCE,
  READ_PAGE_LOG_TOOL,
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
