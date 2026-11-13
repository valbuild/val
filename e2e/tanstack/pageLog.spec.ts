import { expect } from "@playwright/test";
import { openStudio, test } from "../studio";
import { askThePage, PREVIEW } from "./askThePage";

/**
 * What went wrong on the page in the preview, as the assistant's
 * `read_page_log` reads it (`pageLog.ts`).
 *
 * In a real browser because that is where everything it hears comes from:
 * a real `console`, a real `fetch` that 404s, a real `<img>` whose `error`
 * does not bubble. The Studio's half -- the tool, and asking only a bridge
 * that lists `readPageLog` -- is unit tested (`pageTools.test.ts`,
 * `canvasCapabilities.test.tsx`); this is the page's half, asked the way the
 * Studio asks it.
 */
test.use({ viewport: { width: 1512, height: 900 } });

test.describe("the page's log", () => {
  test("the page says what went wrong on it", async ({ page }) => {
    await openStudio(page);
    await page.getByRole("button", { name: "Open the canvas" }).click();
    await expect(
      page.getByRole("tab", { name: /On this page \d/ }),
    ).toBeVisible({ timeout: 60_000 });

    // Break the page: an error, a request that 404s, an image that will not
    // load -- each the way a site's own code would.
    const preview = page.frameLocator(PREVIEW);
    await preview.locator("body").evaluate(async (body) => {
      console.error("e2e: the hero failed to render");
      await fetch("/e2e-no-such-endpoint.json").catch(() => undefined);
      const img = document.createElement("img");
      img.src = "/e2e-no-such-image.png";
      body.appendChild(img);
      await new Promise((resolve) => img.addEventListener("error", resolve));
    });

    // A fetch that fails, fired and forgotten, is still an unhandled
    // rejection for the page's own error reporting: the log watches it
    // without handling it.
    const unhandled = await preview.locator("body").evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 10_000);
          window.addEventListener(
            "unhandledrejection",
            (event) => {
              event.preventDefault();
              clearTimeout(timer);
              resolve(true);
            },
            { once: true },
          );
          void fetch("http://127.0.0.1:1/e2e-unreachable");
        }),
    );
    expect(unhandled, "a failed fetch nobody handled went unreported").toBe(
      true,
    );

    const answer = await askThePage(
      page,
      { type: "readPageLog" },
      "pageLogRead",
    );
    const log = answer["log"];
    expect(log).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          source: "console",
          text: "e2e: the hero failed to render",
        }),
        expect.objectContaining({
          source: "request",
          status: 404,
          url: expect.stringContaining("/e2e-no-such-endpoint.json"),
        }),
        expect.objectContaining({
          source: "resource",
          tag: "img",
          url: expect.stringContaining("/e2e-no-such-image.png"),
        }),
      ]),
    });
    // Val's own traffic -- the provider talking to /api/val -- is not in it.
    expect(JSON.stringify(log)).not.toContain("/api/val");

    // And every read_page counts it.
    const read = await askThePage(page, { type: "readPage" }, "pageRead");
    const counts: unknown = Reflect.get(Object(read["snapshot"]), "log");
    expect(counts).toMatchObject({
      errors: expect.any(Number),
      failedRequests: expect.any(Number),
    });
    // At least what was broken here: the page may log more of its own.
    expect(Reflect.get(Object(counts), "errors")).toBeGreaterThanOrEqual(1);
    expect(
      Reflect.get(Object(counts), "failedRequests"),
    ).toBeGreaterThanOrEqual(2);
  });
});
