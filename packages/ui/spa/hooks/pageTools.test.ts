import { NO_PREVIEW, runReadPage, runScreenshotPage } from "./pageTools";

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
