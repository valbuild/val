import { expect, test, type Locator, type Page } from "@playwright/test";
import { clearPatchChain, openStudio } from "./studio";

/**
 * `s.video()` in the Studio, against `examples/next/content/videoFields.val.ts`.
 *
 * The upload fixture is a VP9/Opus WebM, not an mp4, and that is the point of
 * it: the Chromium Playwright ships has no H.264 at all, neither to decode nor
 * to encode. So in this browser a plain upload can be read and played, and a
 * STREAMING upload cannot be converted — which is exactly the fallback a real
 * editor on such a browser gets, and the one path a CI browser can check:
 * the original file goes up, and the field says why.
 */
const CLIP = "e2e/fixtures/clip-320x180.webm";
const MODULE = "/content/videoFields.val.ts";

test.beforeEach(async ({ request }) => {
  await clearPatchChain(request);
});

function videoPicker(studio: Locator): Locator {
  return studio.locator('input[type="file"][id^="video_input:"]');
}

function fieldValue(page: Page, field: string): Promise<unknown> {
  return page.evaluate(
    ({ mfp, field }) => {
      const peek = (
        window as unknown as {
          __VAL_STORES__: {
            system: {
              sourceStore: {
                peek(p: string): { status: string; data?: unknown };
              };
            };
          };
        }
      ).__VAL_STORES__.system.sourceStore.peek(mfp);
      if (peek.status !== "ready") return peek.status;
      const data = peek.data as Record<string, unknown> | null;
      return data ? data[field] : null;
    },
    { mfp: MODULE, field },
  );
}

test("a committed video renders with its poster and caption track", async ({
  page,
}) => {
  await openStudio(page, `/val/~${MODULE}?p=%22clip%22`);
  const studio = page.locator("#val-shadow-root");
  const video = studio.locator("video");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute(
    "poster",
    "/test/videos/intro-poster_a627f.webp",
  );
  await expect(video.locator("track")).toHaveAttribute(
    "src",
    "/test/videos/intro-en_150f1.vtt",
  );
  await expect(studio.locator("text=encountered an error")).toHaveCount(0);
});

test("an empty video field renders instead of a stack trace", async ({
  page,
}) => {
  await openStudio(page, `/val/~${MODULE}?p=%22empty%22`);
  const studio = page.locator("#val-shadow-root");
  await expect(videoPicker(studio)).toBeAttached();
  await expect(studio.locator("text=encountered an error")).toHaveCount(0);
});

test("an upload writes the metadata and a poster, and the draft plays", async ({
  page,
}) => {
  await openStudio(page, `/val/~${MODULE}?p=%22empty%22`);
  const studio = page.locator("#val-shadow-root");
  await videoPicker(studio).setInputFiles(CLIP);

  await expect
    .poll(() => fieldValue(page, "empty"), { timeout: 60_000 })
    .toMatchObject({
      path: expect.stringMatching(
        /^\/public\/test\/videos\/clip-320x180_[0-9a-f]{5}\.webm$/,
      ),
      mimeType: "video/webm",
      width: 320,
      height: 180,
      duration: expect.closeTo(3, 0),
      posterTime: 1,
      poster: {
        path: expect.stringMatching(
          /^\/public\/test\/videos\/clip-320x180-poster_[0-9a-f]{5}\.(webp|jpg)$/,
        ),
        width: 320,
        height: 180,
      },
    });

  // The draft is served by `/api/val/files?patch_id=…` — and a `<video>` will
  // only read it with Range support and a video Content-Type.
  const video = studio.locator("video");
  await expect(video).toHaveAttribute(
    "src",
    /\/api\/val\/files\/public\/test\/videos\/clip-320x180_[0-9a-f]{5}\.webm\?patch_id=/,
    { timeout: 60_000 },
  );
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(1);
});

test("a streaming field falls back to the original where the browser cannot convert", async ({
  page,
}) => {
  await openStudio(page, `/val/~${MODULE}?p=%22stream%22`);
  const studio = page.locator("#val-shadow-root");
  await videoPicker(studio).setInputFiles(CLIP);

  await expect(
    studio.locator("text=cannot convert video to a stream"),
  ).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => fieldValue(page, "stream"), { timeout: 60_000 })
    .toMatchObject({
      path: expect.stringMatching(/\.webm$/),
      mimeType: "video/webm",
    });
});
