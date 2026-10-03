import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
} from "@playwright/test";
import { clearPatchChain, openStudio, patchThroughStore } from "../studio";
import { serverField, serverFileOps, serverSource } from "./serverState";

/**
 * `s.videoset()` and the `s.video(set)` field that picks from it, against the
 * showcase's `videos.val.ts` and `video.val.ts`'s `fromSet`.
 *
 * The set streams its uploads, and the Chromium Playwright ships cannot
 * encode H.264 — so, as in `video.spec.ts`, an upload here takes the
 * fallback and the original WebM goes up. What these tests are about is
 * where it goes: into the SET, with the field naming it by path.
 */
const CLIP = "e2e/fixtures/clip-320x180.webm";
const SET = "/src/content/videos.val.ts";
const PAGE = "/src/content/video.val.ts";

test.beforeEach(async ({ request }) => {
  await clearPatchChain(request);
});

function fromSet(request: APIRequestContext): Promise<unknown> {
  return serverField(request, PAGE, "fromSet");
}

async function setKeys(request: APIRequestContext): Promise<string[]> {
  const data = await serverSource(request, SET);
  return typeof data === "object" && data !== null ? Object.keys(data) : [];
}

function videoPicker(studio: Locator): Locator {
  return studio.locator('input[type="file"][id^="video_input:"]');
}

test("the page plays a set-backed video, with what the set knows about it", async ({
  page,
}) => {
  await page.goto("/showcase");
  const video = page.getByTestId("video-from-set");
  await expect(video).toHaveAttribute(
    "src",
    /\/val\/videoset\/intro_51df2\.mp4/,
  );
  // The field holds only `path`, `alt` and `startTime`: the mime type that
  // picks `<source type>`-less playback is the set's, filled in by the reader.
  await expect(video).toHaveAttribute(
    "aria-label",
    "The test pattern, from 0:01",
  );
});

test("the set is listed under Media and opens as a gallery of videos", async ({
  page,
}) => {
  await openStudio(page, `/val/~${SET}`);
  const studio = page.locator("#val-shadow-root");
  // The stream is one entry, named by its directory, not as `master.m3u8`
  // beside every playlist and segment of it.
  await expect(studio.getByText("intro_51df2.mp4").first()).toBeVisible();
  await expect(studio.getByText("intro_05198").first()).toBeVisible();
  await expect(studio.getByText("master.m3u8")).toHaveCount(0);
  await expect(studio.getByText("stream_0.mp4")).toHaveCount(0);
  await expect(studio.locator("text=encountered an error")).toHaveCount(0);
});

test("an upload into the set adds an entry with its metadata", async ({
  page,
  request,
}) => {
  await openStudio(page, `/val/~${SET}`);
  const studio = page.locator("#val-shadow-root");
  await studio.locator('input[type="file"]').first().setInputFiles(CLIP);

  await expect(
    studio.locator("text=cannot convert video to a stream"),
  ).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(
      async () => {
        const data = await serverSource(request, SET);
        if (typeof data !== "object" || data === null) return data;
        const entry = Object.entries(data).find(([key]) =>
          key.includes("clip-320x180"),
        );
        return entry ? { key: entry[0], ...entry[1] } : null;
      },
      { timeout: 60_000 },
    )
    .toMatchObject({
      key: expect.stringMatching(
        /^\/public\/val\/videoset\/clip-320x180_[0-9a-f]{5}\.webm$/,
      ),
      mimeType: "video/webm",
      width: 320,
      height: 180,
      duration: expect.closeTo(3, 0),
      alt: null,
    });
});

test("a set-backed field picks another video from the set", async ({
  page,
  request,
}) => {
  await openStudio(page, `/val/~${PAGE}?p=%22fromSet%22`);
  const studio = page.locator("#val-shadow-root");
  await studio.getByRole("combobox", { name: "Choose asset" }).click();
  await studio.getByText("intro_05198", { exact: true }).click();

  await expect
    .poll(() => fromSet(request), { timeout: 30_000 })
    .toEqual({ path: "/public/val/videoset/intro_05198/master.m3u8" });
});

test("an upload in a set-backed field goes into the set, and the field names it", async ({
  page,
  request,
}) => {
  await openStudio(page, `/val/~${PAGE}?p=%22fromSet%22`);
  const studio = page.locator("#val-shadow-root");
  const before = await setKeys(request);
  await videoPicker(studio).setInputFiles(CLIP);

  await expect
    .poll(() => fromSet(request), { timeout: 60_000 })
    .toMatchObject({
      path: expect.stringMatching(
        /^\/public\/val\/videoset\/clip-320x180_[0-9a-f]{5}\.webm$/,
      ),
      // Kept from the video it replaced: the description is the field's own.
      alt: "The test pattern, from 0:01",
      posterTime: 1,
    });
  const field = await fromSet(request);
  // What is true of the file is the set's, never repeated on the field.
  expect(field).not.toHaveProperty("mimeType");
  expect(field).not.toHaveProperty("duration");

  await expect
    .poll(
      async () => (await setKeys(request)).filter((k) => !before.includes(k)),
      {
        timeout: 30_000,
      },
    )
    .toEqual([
      expect.stringMatching(
        /^\/public\/val\/videoset\/clip-320x180_[0-9a-f]{5}\.webm$/,
      ),
    ]);
  // The card shows the set's metadata for it.
  await expect(studio.getByText(/^320×180 · /)).toBeVisible({
    timeout: 30_000,
  });
});

test.describe("renaming a video of the set", () => {
  async function renameOpenEntry(studio: Locator, to: string) {
    await studio.getByRole("button", { name: "Rename file" }).click();
    const input = studio.getByRole("textbox", { name: "File name" });
    await input.fill(to);
    await input.press("Enter");
  }

  test("a file: the entry moves, and the field using it follows", async ({
    page,
    request,
  }) => {
    const key = "/public/val/videoset/intro_51df2.mp4";
    await openStudio(
      page,
      `/val/~${SET}?p=${encodeURIComponent(JSON.stringify(key))}`,
    );
    const studio = page.locator("#val-shadow-root");
    await expect(
      studio.getByText("Renaming updates the 1 place using it."),
    ).toBeVisible({ timeout: 30_000 });
    await renameOpenEntry(studio, "team-intro");

    const renamed = "/public/val/videoset/team-intro_51df2.mp4";
    await expect
      .poll(() => setKeys(request), { timeout: 60_000 })
      .toContain(renamed);
    expect(await setKeys(request)).not.toContain(key);
    await expect
      .poll(() => fromSet(request), { timeout: 30_000 })
      .toMatchObject({ path: renamed, startTime: 1 });
  });

  test("a stream: the directory moves whole, and the field using it follows", async ({
    page,
    request,
  }) => {
    const key = "/public/val/videoset/intro_05198/master.m3u8";
    await openStudio(
      page,
      `/val/~${SET}?p=${encodeURIComponent(JSON.stringify(key))}`,
    );
    await patchThroughStore(page, PAGE, [
      { op: "replace", path: ["fromSet"], value: { path: key } },
    ]);
    const studio = page.locator("#val-shadow-root");
    await expect(
      studio.getByText("Renaming updates the 1 place using it."),
    ).toBeVisible({ timeout: 30_000 });
    await renameOpenEntry(studio, "team-stream");

    const renamed = "/public/val/videoset/team-stream_05198/master.m3u8";
    await expect
      .poll(() => setKeys(request), { timeout: 60_000 })
      .toContain(renamed);
    expect(await setKeys(request)).not.toContain(key);
    await expect
      .poll(() => fromSet(request), { timeout: 30_000 })
      .toEqual({ path: renamed });
    // Served as a stream from its new directory.
    const patchId = (await serverFileOps(request)).find(
      (op) => op.filePath === renamed && !op.deleted,
    )?.patchId;
    expect(patchId).toBeDefined();
    const served = await request.get(
      `/api/val/files${renamed}?patch_id=${patchId}`,
    );
    expect(served.status()).toBe(200);
    expect(await served.text()).toContain("team-stream_05198/stream_0.m3u8");
  });
});
