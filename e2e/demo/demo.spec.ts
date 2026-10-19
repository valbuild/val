import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { makeJpeg, withExifOrientation } from "./photo";

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

    const jpeg = await makeJpeg(page, { width: 3200, height: 2000 });
    await page
      .locator(`[data-val-studio-path$='"hero"."image"']`)
      .first()
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "photo.jpg",
        mimeType: "image/jpeg",
        buffer: jpeg,
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

/**
 * Where a request for libwebp's WebAssembly went, by path.
 *
 * Its URL is not under `/api/val` in a built Studio: the build points it at the
 * static host (`DEFAULT_STATIC_HOST`, `packages/ui/build/staticWasm.ts`), so
 * `refuseTheNetwork` never sees it -- and must not refuse it if it did: the
 * one place it may come from is the network. In development the Studio is
 * served by Vite, and the file comes from `/api/val/static/…`, which is let
 * through as the Studio's own. Either way it is answered here: from Vite as it
 * is, and from `node_modules` for the static host, where a binary is uploaded
 * at release and a test cannot wait for that.
 */
async function serveWebpWasm(context: BrowserContext): Promise<string[]> {
  const fetched: string[] = [];
  await context.route(/\/webp_enc(_simd)?(-[\w-]{8})?\.wasm(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    /*
     * Under Vite's dev server, `import url from "….wasm?url"` is itself a
     * request -- for a module whose one export is the URL string. It carries
     * no binary, and a built Studio has no such request at all.
     */
    if (route.request().resourceType() === "script") {
      return route.continue();
    }
    fetched.push(url.pathname);
    if (url.hostname === "localhost") {
      return route.continue();
    }
    const simd = url.pathname.includes("webp_enc_simd");
    return route.fulfill({
      body: fs.readFileSync(
        path.join(
          path.dirname(
            createRequire(
              path.join(process.cwd(), "packages/ui/package.json"),
            ).resolve("@jsquash/webp/package.json"),
          ),
          "codec/enc",
          simd ? "webp_enc_simd.wasm" : "webp_enc.wasm",
        ),
      ),
      contentType: "application/wasm",
      // What the real host sends: the Studio fetches it cross-origin.
      headers: {
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
      },
    });
  });
  return fetched;
}

/** Upload a photo to the home page's hero image, and wait for it to show. */
async function uploadHeroPhoto(
  page: Page,
  name: string,
  jpeg: Buffer,
): Promise<void> {
  const hero = canvas(page).locator("img.hero-image");
  const before = await hero.getAttribute("src");
  await page
    .locator(`[data-val-studio-path$='"hero"."image"']`)
    .first()
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name, mimeType: "image/jpeg", buffer: jpeg });
  await expect(hero).not.toHaveAttribute("src", before ?? "", {
    timeout: 30_000,
  });
  await expect(hero).toHaveAttribute("src", /\.webp\?patch_id=/, {
    timeout: 30_000,
  });
  await expect
    .poll(() => hero.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
}

/** What the hero image's file is, read the way the page reads it. */
async function heroFile(page: Page) {
  return canvas(page)
    .locator("img.hero-image")
    .evaluate(async (img: HTMLImageElement) => {
      const response = await fetch(img.src);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const ascii = (from: number, to: number) =>
        String.fromCharCode(...bytes.subarray(from, to));
      // Which corner the red square is in, so a test can tell which way up.
      const draw = document.createElement("canvas");
      draw.width = img.naturalWidth;
      draw.height = img.naturalHeight;
      const ctx = draw.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0);
      const isRed = (x: number, y: number) => {
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        return r > 200 && g < 80 && b < 80;
      };
      return {
        contentType: response.headers.get("content-type"),
        // RIFF....WEBP: the bytes are a WebP, whatever the name says.
        magic: `${ascii(0, 4)}${ascii(8, 12)}`,
        width: img.naturalWidth,
        height: img.naturalHeight,
        redCorner: isRed(10, 10)
          ? "top-left"
          : isRed(img.naturalWidth - 10, 10)
            ? "top-right"
            : "neither",
      };
    });
}

test.describe("WebP in a browser whose canvas cannot write it", () => {
  /*
   * Safari, as far as the encoder can tell: asked for WebP, `toBlob` answers
   * with a PNG and no error. Faked rather than run in WebKit because whether
   * a given WebKit build writes WebP is the platform's choice, not ours, and
   * this has to fail the same way on every CI runner.
   */
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        if (type === "image/webp") {
          return toBlob.call(this, callback, "image/png");
        }
        return toBlob.call(this, callback, type, quality);
      };
    });
  });

  test("a photo is encoded to WebP with WebAssembly, and the encoder is fetched once", async ({
    page,
    context,
  }) => {
    const escaped = await refuseTheNetwork(context);
    const wasm = await serveWebpWasm(context);
    await openDemo(page);
    await closeTour(page);
    // Proves the fake: without it this test proves nothing about Safari.
    expect(
      await page.evaluate(
        () =>
          new Promise<string | undefined>((resolve) => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            canvas.toBlob((blob) => resolve(blob?.type), "image/webp");
          }),
      ),
    ).toBe("image/png");

    await uploadHeroPhoto(
      page,
      "photo.jpg",
      await makeJpeg(page, { width: 3200, height: 2000 }),
    );
    expect(await heroFile(page)).toEqual({
      contentType: "image/webp",
      magic: "RIFFWEBP",
      width: 2560,
      height: 1600,
      redCorner: "top-left",
    });
    expect(wasm).toHaveLength(1);

    /*
     * A second photo, which a phone took held upright: its pixels are stored
     * sideways with an EXIF Orientation of 6. Two things at once: the encoder
     * is not fetched again, and decoding straight to the target size -- what
     * keeps a 48 MP photo under iOS's canvas limit -- did not undo the
     * orientation. Undone, it comes out 2560x1600, or squashed.
     */
    await uploadHeroPhoto(
      page,
      "portrait.jpg",
      withExifOrientation(
        await makeJpeg(page, { width: 3200, height: 2000 }),
        6,
      ),
    );
    expect(await heroFile(page)).toEqual({
      contentType: "image/webp",
      magic: "RIFFWEBP",
      width: 1600,
      height: 2560,
      // A quarter turn clockwise takes the top-left corner to the top-right.
      redCorner: "top-right",
    });
    expect(wasm).toHaveLength(1);
    expect(escaped).toEqual([]);
  });
});

test.describe("WebP in a browser whose canvas can write it", () => {
  test("never downloads the WebAssembly encoder, nor its JavaScript", async ({
    page,
    context,
  }) => {
    const escaped = await refuseTheNetwork(context);
    const wasm = await serveWebpWasm(context);
    const encoderCode: string[] = [];
    context.on("request", (request) => {
      if (/webpWasm|jsquash/.test(request.url())) {
        encoderCode.push(request.url());
      }
    });
    await openDemo(page);
    await closeTour(page);

    await uploadHeroPhoto(
      page,
      "photo.jpg",
      await makeJpeg(page, { width: 3200, height: 2000 }),
    );
    expect(await heroFile(page)).toEqual({
      contentType: "image/webp",
      magic: "RIFFWEBP",
      width: 2560,
      height: 1600,
      redCorner: "top-left",
    });
    expect(wasm).toEqual([]);
    expect(encoderCode).toEqual([]);
    expect(escaped).toEqual([]);
  });
});
