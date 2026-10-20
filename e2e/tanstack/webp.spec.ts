import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { clearPatchChain, openStudio, test } from "../studio";
import { makeJpeg, withExifOrientation } from "../photo";
import { serverField, serverFileOps } from "./serverState";

/**
 * `encode: { type: "webp" }` where the browser's canvas cannot write WebP --
 * Safari -- and where it can.
 *
 * Against the showcase's `optimised` field (`src/content/media.val.ts`), which
 * converts uploads to WebP and caps them at 1200px. Where the canvas answers a
 * WebP request with a PNG, the Studio encodes the canvas's pixels with libwebp
 * compiled to WebAssembly (`packages/ui/spa/utils/webpWasm.ts`), fetched once
 * per page; where the canvas writes WebP itself, that encoder is never fetched.
 * See `architecture/media.md`.
 */

const MODULE = "/src/content/media.val.ts";
const FIELD = "optimised";

test.beforeEach(async ({ request }) => {
  await clearPatchChain(request);
});

/**
 * Where a request for libwebp's WebAssembly went, by path.
 *
 * In development the Studio is served by Vite, and the file comes from
 * `/api/val/static/…` on this server, so it is let through as it is. A built
 * Studio points it at the static host (`DEFAULT_STATIC_HOST`,
 * `packages/ui/build/staticWasm.ts`), where a binary is uploaded at release and
 * a test cannot wait for that, so that one is answered from `node_modules`.
 */
async function serveWebpWasm(context: BrowserContext): Promise<string[]> {
  const fetched: string[] = [];
  await context.route(/\/webp_enc(_simd)?(-[\w-]{8})?\.wasm(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    // Under Vite, `import url from "….wasm?url"` is itself a request -- for a
    // module whose one export is the URL string. It carries no binary.
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
      headers: {
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
      },
    });
  });
  return fetched;
}

/** The path the field holds once the server has the upload. */
async function waitForUploadedPath(
  request: APIRequestContext,
  previous: string | null,
): Promise<string> {
  let uploaded = "";
  await expect
    .poll(
      async () => {
        const value = await serverField(request, MODULE, FIELD);
        const p =
          typeof value === "object" && value !== null && "path" in value
            ? value.path
            : null;
        uploaded = typeof p === "string" ? p : "";
        return uploaded !== "" && uploaded !== previous;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return uploaded;
}

/** Upload a photo to the field, and return the path it was stored at. */
async function uploadPhoto(
  page: Page,
  request: APIRequestContext,
  name: string,
  jpeg: Buffer,
  previous: string | null,
): Promise<string> {
  await page
    .locator("#val-shadow-root")
    .locator('input[type="file"][id^="img_input:"]')
    .first()
    .setInputFiles({ name, mimeType: "image/jpeg", buffer: jpeg });
  return waitForUploadedPath(request, previous);
}

/** What the server serves for that path, read the way a page reads it. */
async function storedFile(
  page: Page,
  request: APIRequestContext,
  filePath: string,
) {
  const op = (await serverFileOps(request)).find(
    (o) => o.filePath === filePath && !o.deleted,
  );
  if (!op) throw new Error(`no file op for ${filePath}`);
  const url = `/api/val/files${filePath}?patch_id=${op.patchId}`;
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ascii = (from: number, to: number) =>
      String.fromCharCode(...bytes.subarray(from, to));
    const bitmap = await createImageBitmap(blob);
    // Which corner the red square is in, so a test can tell which way up.
    const draw = document.createElement("canvas");
    draw.width = bitmap.width;
    draw.height = bitmap.height;
    const ctx = draw.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0);
    const isRed = (x: number, y: number) => {
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return r > 200 && g < 80 && b < 80;
    };
    return {
      contentType: response.headers.get("content-type"),
      // RIFF....WEBP: the bytes are a WebP, whatever the name says.
      magic: `${ascii(0, 4)}${ascii(8, 12)}`,
      width: bitmap.width,
      height: bitmap.height,
      redCorner: isRed(5, 5)
        ? "top-left"
        : isRed(bitmap.width - 5, 5)
          ? "top-right"
          : "neither",
    };
  }, url);
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
    request,
  }) => {
    const wasm = await serveWebpWasm(context);
    await openStudio(page, `/val/~${MODULE}?p=%22${FIELD}%22`);
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

    const first = await uploadPhoto(
      page,
      request,
      "photo.jpg",
      await makeJpeg(page, { width: 3200, height: 2000 }),
      null,
    );
    expect(first).toMatch(/\.webp$/);
    expect(await storedFile(page, request, first)).toEqual({
      contentType: "image/webp",
      magic: "RIFFWEBP",
      width: 1200,
      height: 750,
      redCorner: "top-left",
    });
    expect(wasm).toHaveLength(1);

    /*
     * A second photo, which a phone took held upright: its pixels are stored
     * sideways with an EXIF Orientation of 6. The encoder is not fetched
     * again, and the pixels it is handed off the canvas are the oriented ones
     * -- the WebP carries no EXIF, so an orientation lost on the way would
     * come out 1200x750, landscape.
     */
    const second = await uploadPhoto(
      page,
      request,
      "portrait.jpg",
      withExifOrientation(
        await makeJpeg(page, { width: 3200, height: 2000 }),
        6,
      ),
      first,
    );
    expect(await storedFile(page, request, second)).toEqual({
      contentType: "image/webp",
      magic: "RIFFWEBP",
      // Fitted inside 1200 wide by the default 2560 high: 2000x3200 upright.
      width: 1200,
      height: 1920,
      // A quarter turn clockwise takes the top-left corner to the top-right.
      redCorner: "top-right",
    });
    expect(wasm).toHaveLength(1);
  });
});

test.describe("WebP in a browser whose canvas can write it", () => {
  test("never downloads the WebAssembly encoder, nor its JavaScript", async ({
    page,
    context,
    request,
  }) => {
    const wasm = await serveWebpWasm(context);
    const encoderCode: string[] = [];
    context.on("request", (r) => {
      if (/webpWasm|jsquash/.test(r.url())) {
        encoderCode.push(r.url());
      }
    });
    await openStudio(page, `/val/~${MODULE}?p=%22${FIELD}%22`);

    const uploaded = await uploadPhoto(
      page,
      request,
      "photo.jpg",
      await makeJpeg(page, { width: 3200, height: 2000 }),
      null,
    );
    expect(await storedFile(page, request, uploaded)).toEqual({
      contentType: "image/webp",
      magic: "RIFFWEBP",
      width: 1200,
      height: 750,
      redCorner: "top-left",
    });
    expect(wasm).toEqual([]);
    expect(encoderCode).toEqual([]);
  });
});
