import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * The demo: the real Studio, with Val's server running in the tab.
 *
 * What these protect is the promise the demo makes -- edit anything, and
 * nothing leaves the tab -- so every test fails a request to `/api/val` that
 * is not one of the Studio's own files, and asserts there were none. A feature
 * that reaches for the network some way other than through the Studio's
 * client (an upload URL, a raw `fetch`) breaks the demo, and this is where it
 * shows. See `docs/plans/demo-mode.md`.
 *
 * On the CONTEXT, not the page: uploads and unpublished files are answered by
 * the demo's service worker, and `page.route` does not see a request a
 * service worker handled -- nor one it let through. `context.route` sees the
 * second, which is the one that would be a leak.
 */

const TITLE = "Coffee, roasted this week";

/** Fails, and records, every request the in-tab server should have answered. */
async function refuseTheNetwork(context: BrowserContext): Promise<string[]> {
  const escaped: string[] = [];
  await context.route("**/api/val/**", async (route) => {
    const url = new URL(route.request().url());
    // The Studio's own files, and the service worker that relays uploads.
    if (
      url.pathname.startsWith("/api/val/static") ||
      url.pathname === "/api/val/demo-sw.js"
    ) {
      return route.continue();
    }
    escaped.push(`${route.request().method()} ${url.pathname}`);
    return route.abort();
  });
  return escaped;
}

/** The home page's title field, in the Studio. */
function titleField(page: Page) {
  return page
    .locator(`[data-val-studio-path$='"hero"."title"']`)
    .getByRole("textbox")
    .first();
}

/** The page in the Studio's canvas. */
function canvas(page: Page) {
  return page.frameLocator('iframe[title^="Preview of"]');
}

async function openDemo(page: Page) {
  // `/val` redirects to the home page with the canvas open.
  await page.goto("/val");
  await expect(titleField(page)).toBeVisible({ timeout: 60_000 });
}

async function closeTour(page: Page) {
  const tour = page.getByRole("dialog").filter({ hasText: "Welcome to Val" });
  if (await tour.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden();
  }
}

test.describe("the demo", () => {
  test("an edit shows in the page, and nothing is sent anywhere", async ({
    page,
    context,
  }) => {
    const escaped = await refuseTheNetwork(context);
    await openDemo(page);
    await closeTour(page);

    await expect(canvas(page).locator("h1")).toHaveText(TITLE, {
      timeout: 30_000,
    });
    await titleField(page).fill("Hello from the demo");
    await expect(canvas(page).locator("h1")).toHaveText("Hello from the demo");

    expect(escaped).toEqual([]);
  });

  test("reloading starts over, and so does Start over", async ({
    page,
    context,
  }) => {
    const escaped = await refuseTheNetwork(context);
    await openDemo(page);
    await closeTour(page);

    await titleField(page).fill("Gone after a reload");
    await expect(canvas(page).locator("h1")).toHaveText("Gone after a reload");
    await page.reload();
    await expect(titleField(page)).toHaveValue(TITLE, { timeout: 60_000 });

    await titleField(page).fill("Gone after Start over");
    await expect(canvas(page).locator("h1")).toHaveText(
      "Gone after Start over",
    );
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(titleField(page)).toHaveValue(TITLE, { timeout: 60_000 });

    expect(escaped).toEqual([]);
  });

  test("the tour opens on a first visit, and not again in the same tab", async ({
    page,
    context,
  }) => {
    await refuseTheNetwork(context);
    await openDemo(page);
    const tour = page.getByRole("dialog").filter({ hasText: "Welcome to Val" });
    await expect(tour).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden();

    await page.reload();
    await expect(titleField(page)).toBeVisible({ timeout: 60_000 });
    await expect(tour).toBeHidden();
  });

  test("Publish says what it would do instead of doing it", async ({
    page,
    context,
  }) => {
    const escaped = await refuseTheNetwork(context);
    await openDemo(page);
    await closeTour(page);
    await page.getByRole("button", { name: "Publish" }).first().click();
    await expect(page.getByText("Publishing is off in the demo")).toBeVisible();
    expect(escaped).toEqual([]);
  });

  test("Open in a new tab is there, but off, and says why", async ({
    page,
    context,
  }) => {
    const escaped = await refuseTheNetwork(context);
    await openDemo(page);
    await closeTour(page);
    await page.getByRole("button", { name: "Other ways to preview" }).click();
    const newTab = page.getByRole("menuitem", { name: /Open in a new tab/ });
    await expect(newTab).toHaveAttribute("aria-disabled", "true");
    await newTab.hover();
    await expect(
      page.getByRole("tooltip").filter({ hasText: "Not in the demo" }),
    ).toBeVisible();
    // Pressed as a person would on a keyboard; the tooltip is over it for a
    // pointer, which is the tooltip doing its job.
    await newTab.press("Enter");
    expect(context.pages()).toHaveLength(1);
    expect(escaped).toEqual([]);
  });
});

test.describe("uploads in the demo", () => {
  test("a photo is converted and scaled down before it is sent, and shows in the page", async ({
    page,
    context,
  }) => {
    const escaped = await refuseTheNetwork(context);
    await openDemo(page);
    await closeTour(page);
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller !== null),
    ).toBe(true);

    // A camera-sized JPEG, made in the page so there is no fixture to keep.
    const jpeg = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 3200;
      canvas.height = 2000;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const gradient = ctx.createLinearGradient(0, 0, 3200, 2000);
      gradient.addColorStop(0, "#3b2314");
      gradient.addColorStop(1, "#d9a25b");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 3200, 2000);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.95),
      );
      if (!blob) throw new Error("no jpeg");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    });
    await page
      .locator(`[data-val-studio-path$='"hero"."image"']`)
      .first()
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "photo.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from(jpeg, "base64"),
      });

    const hero = canvas(page).locator("img.hero-image");
    await expect(hero).toHaveAttribute("src", /\.webp\?patch_id=/, {
      timeout: 30_000,
    });
    await expect
      .poll(() => hero.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(2560);
    expect(escaped).toEqual([]);
  });

  test("a video plays in the page, and seeks", async ({ page, context }) => {
    const escaped = await refuseTheNetwork(context);
    await openDemo(page);
    await closeTour(page);
    // The WebM is uploaded as it is: Playwright's Chromium has no H.264, so it
    // cannot make a stream (see `e2e/tanstack/video.spec.ts`). Seeking is the
    // part that needs the relay to answer `Range` requests.
    await page
      .locator(`[data-val-studio-path$='"film"."video"']`)
      .first()
      .locator('input[type="file"]')
      .first()
      .setInputFiles("e2e/fixtures/clip-320x180.webm");

    const video = canvas(page).locator(".film video");
    await expect(video).toHaveAttribute("src", /\.webm\?patch_id=/, {
      timeout: 60_000,
    });
    await expect
      .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(2);
    const seekedTo = await video.evaluate(
      (el: HTMLVideoElement) =>
        new Promise<number>((resolve) => {
          el.addEventListener("seeked", () => resolve(el.currentTime), {
            once: true,
          });
          el.currentTime = 2;
        }),
    );
    expect(seekedTo).toBeCloseTo(2, 0);
    expect(escaped).toEqual([]);
  });
});
