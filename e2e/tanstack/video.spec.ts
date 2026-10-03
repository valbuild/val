import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
} from "@playwright/test";
import { clearPatchChain, openStudio } from "../studio";
import { serverField, serverFileOps } from "./serverState";

/**
 * `s.video()` in the Studio, against the showcase's `examples/tanstack/src/content/video.val.ts`.
 *
 * The upload fixture is a VP9/Opus WebM, not an mp4, and that is the point of
 * it: the Chromium Playwright ships has no H.264 at all, neither to decode nor
 * to encode. So in this browser a plain upload can be read and played, and a
 * STREAMING upload cannot be converted — which is exactly the fallback a real
 * editor on such a browser gets, and the one path a CI browser can check:
 * the original file goes up, and the field says why.
 */
const CLIP = "e2e/fixtures/clip-320x180.webm";
const MODULE = "/src/content/video.val.ts";

test.beforeEach(async ({ request }) => {
  await clearPatchChain(request);
});

function videoPicker(studio: Locator): Locator {
  return studio.locator('input[type="file"][id^="video_input:"]');
}

function fieldValue(
  request: APIRequestContext,
  field: string,
): Promise<unknown> {
  return serverField(request, MODULE, field);
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
    "/val/videos/intro-poster_a627f.webp",
  );
  await expect(video.locator("track")).toHaveAttribute(
    "src",
    "/val/videos/intro-en_150f1.vtt",
  );
  await expect(studio.locator("text=encountered an error")).toHaveCount(0);
});

test("an empty video field renders instead of a stack trace", async ({
  page,
}) => {
  await openStudio(page, `/val/~${MODULE}?p=%22background%22`);
  const studio = page.locator("#val-shadow-root");
  await expect(videoPicker(studio)).toBeAttached();
  await expect(studio.locator("text=encountered an error")).toHaveCount(0);
});

test("an upload writes the metadata and a poster, and the draft plays", async ({
  page,
  request,
}) => {
  await openStudio(page, `/val/~${MODULE}?p=%22background%22`);
  const studio = page.locator("#val-shadow-root");
  await videoPicker(studio).setInputFiles(CLIP);

  await expect
    .poll(() => fieldValue(request, "background"), { timeout: 60_000 })
    .toMatchObject({
      path: expect.stringMatching(
        /^\/public\/val\/videos\/clip-320x180_[0-9a-f]{5}\.webm$/,
      ),
      mimeType: "video/webm",
      width: 320,
      height: 180,
      duration: expect.closeTo(3, 0),
      posterTime: 1,
      poster: {
        path: expect.stringMatching(
          /^\/public\/val\/videos\/clip-320x180-poster_[0-9a-f]{5}\.(webp|jpg)$/,
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
    /\/api\/val\/files\/public\/val\/videos\/clip-320x180_[0-9a-f]{5}\.webm\?patch_id=/,
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
  request,
}) => {
  await openStudio(page, `/val/~${MODULE}?p=%22stream%22`);
  const studio = page.locator("#val-shadow-root");
  await videoPicker(studio).setInputFiles(CLIP);

  await expect(
    studio.locator("text=cannot convert video to a stream"),
  ).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => fieldValue(request, "stream"), { timeout: 60_000 })
    .toMatchObject({
      path: expect.stringMatching(/\.webm$/),
      mimeType: "video/webm",
    });
});

test.describe("rename", () => {
  /** Every `file` op the server holds: what an upload or a rename wrote or deleted. */
  async function fileOps(
    request: APIRequestContext,
  ): Promise<{ filePath: string; deleted: boolean }[]> {
    return (await serverFileOps(request)).map(({ filePath, deleted }) => ({
      filePath,
      deleted,
    }));
  }

  async function rename(studio: Locator, to: string) {
    await studio.getByRole("button", { name: "Rename", exact: true }).click();
    const input = studio.getByRole("textbox", { name: "File name" });
    await input.fill(to);
    await input.press("Enter");
  }

  test("a video file is renamed: copied under the new name, the old one deleted", async ({
    page,
    request,
  }) => {
    await openStudio(page, `/val/~${MODULE}?p=%22clip%22`);
    const studio = page.locator("#val-shadow-root");
    await rename(studio, "team-intro");

    await expect
      .poll(() => fieldValue(request, "clip"), { timeout: 60_000 })
      .toMatchObject({
        path: "/public/val/videos/team-intro_51df2.mp4",
        // Everything authored stays where it was.
        posterTime: 1,
        captions: [{ srclang: "en", label: "English" }],
      });
    await expect
      .poll(() => fileOps(request), { timeout: 30_000 })
      .toEqual([
        {
          filePath: "/public/val/videos/team-intro_51df2.mp4",
          deleted: false,
        },
        { filePath: "/public/val/videos/intro_51df2.mp4", deleted: true },
      ]);
  });

  test("a stream is renamed as a directory: every file moves, and the draft is served as a stream", async ({
    page,
    request,
  }) => {
    await openStudio(page, `/val/~${MODULE}?p=%22stream%22`);
    const studio = page.locator("#val-shadow-root");
    await rename(studio, "team-stream");

    await expect
      .poll(() => fieldValue(request, "stream"), { timeout: 60_000 })
      .toMatchObject({
        path: "/public/val/videos/team-stream_05198/master.m3u8",
        mimeType: "application/vnd.apple.mpegurl",
      });
    const names = [
      "master.m3u8",
      "stream_0.m3u8",
      "stream_0.mp4",
      "stream_1.m3u8",
      "stream_1.mp4",
      "stream_2.m3u8",
      "stream_2.mp4",
    ];
    await expect
      .poll(
        async () =>
          (await fileOps(request))
            .map((op) => `${op.deleted ? "-" : "+"}${op.filePath}`)
            .sort(),
        { timeout: 30_000 },
      )
      .toEqual(
        [
          ...names.map((n) => `+/public/val/videos/team-stream_05198/${n}`),
          ...names.map((n) => `-/public/val/videos/intro_05198/${n}`),
        ].sort(),
      );

    // The renamed draft is servable as a stream: the master names its media
    // playlists through the draft endpoint, under the rename's patch id.
    const masterPath = "/public/val/videos/team-stream_05198/master.m3u8";
    const patchId =
      (await serverFileOps(request)).find(
        (op) => op.filePath === masterPath && !op.deleted,
      )?.patchId ?? null;
    expect(patchId).not.toBeNull();
    const served = await request.get(
      `/api/val/files${masterPath}?patch_id=${patchId}`,
    );
    expect(served.status()).toBe(200);
    expect(await served.text()).toContain(
      `/api/val/files/public/val/videos/team-stream_05198/stream_0.m3u8?patch_id=${patchId}`,
    );
  });
});
