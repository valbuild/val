import fs from "fs";
import { expect, test, type Page } from "@playwright/test";
import {
  discardAll,
  mock,
  openHttpStudio,
  peek,
  publishAll,
  sessionCookie,
  writePatch,
} from "./httpMode";

/**
 * A local file in a project with remote files, found by "Check everything" on
 * `/val/validate` and uploaded by its **Fix**.
 *
 * Why it matters: a hosted project starts with its template's images local,
 * and has no repository and no CLI to run `val validate --fix` in. The Studio
 * is the only place they can be moved to remote storage.
 *
 * The local entry is seeded as a draft: a patch adding a key under the remote
 * gallery's directory, with its bytes stored as a LOCAL file. That is the same
 * state as a template's committed image -- a local key in a `.remote()`
 * gallery -- without a fixture file in the example's `public/`, which the
 * gallery would then list as untracked everywhere else.
 */

const MODULE = "/content/remoteImages.val.ts";
const IMAGE = "e2e/fixtures/blue-8x8.png";
const CLIP = "e2e/fixtures/clip-320x180.webm";
const KEY = "/public/remote-images/seeded_00000.png";
const METADATA = { width: 8, height: 8, mimeType: "image/png" };

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

/** Every `file` op in the chain, as `[filePath, remote]`. */
function fileOps(page: Page): Promise<[string, boolean][]> {
  return page.evaluate(() => {
    const store = (
      window as unknown as {
        __VAL_STORES__: {
          system: {
            patchStore: {
              allRecords(): {
                patch: { op: string; filePath?: string; remote?: boolean }[];
              }[];
            };
          };
        };
      }
    ).__VAL_STORES__.system.patchStore;
    return store
      .allRecords()
      .flatMap((record) =>
        record.patch
          .filter((op) => op.op === "file")
          .map((op): [string, boolean] => [op.filePath ?? "", !!op.remote]),
      );
  });
}

test("Check everything reports a local file in a remote gallery, and Fix uploads it", async ({
  page,
}) => {
  await openHttpStudio(page);
  const bytes = fs.readFileSync(IMAGE).toString("base64");
  await writePatch(page, MODULE, [
    { op: "add", path: [KEY], value: { ...METADATA, alt: null } },
    {
      op: "file",
      path: [KEY],
      filePath: KEY,
      value: `data:image/png;base64,${bytes}`,
      remote: false,
      metadata: METADATA,
    },
  ]);

  await page.goto("/val/validate");
  const studio = page.locator("#val-shadow-root");
  await studio.getByRole("button", { name: "Check everything" }).click();

  // An error row, with a Fix, not the command a hosted project cannot run.
  const row = studio.getByRole("listitem").filter({
    hasText: "this one is still a local file",
  });
  await expect(row).toHaveCount(1, { timeout: 60_000 });
  await expect(row.getByText("val validate --fix")).toHaveCount(0);
  await row.getByRole("button", { name: "Fix" }).click();
  await expect(
    row.getByText(/Uploads seeded_00000\.png when published/),
  ).toBeVisible({ timeout: 30_000 });

  // The entry is keyed by its remote ref now, and the bytes went with it,
  // flagged remote.
  const peeked = await peek(page, MODULE);
  const source =
    typeof peeked === "object" && peeked !== null && "data" in peeked
      ? peeked.data
      : undefined;
  const keys = Object.keys(
    typeof source === "object" && source !== null ? source : {},
  );
  expect(keys).toHaveLength(1);
  const [ref] = keys;
  expect(ref).toMatch(
    /^https:\/\/.+\/file\/p\/.+public\/remote-images\/seeded_00000\.png$/,
  );
  expect(await fileOps(page)).toContainEqual([ref, true]);

  // And publishing puts it in remote storage.
  const published = await publishAll(page, "Upload a local image");
  expect(published.status, published.message ?? "").toBe("published");
  const state = await mock.state();
  expect(
    state.remoteFiles.some((file) =>
      file.includes("public/remote-images/seeded_00000.png"),
    ),
    "the file was not moved to remote storage",
  ).toBe(true);
});

test("a local video and its poster in a remote field are uploaded together", async ({
  page,
}) => {
  const FIELDS = "/content/remoteFields.val.ts";
  const VIDEO = "/public/val/clip_00000.webm";
  const POSTER = "/public/val/clip-poster_00000.png";
  await openHttpStudio(page);
  const clip = fs.readFileSync(CLIP).toString("base64");
  const poster = fs.readFileSync(IMAGE).toString("base64");
  await writePatch(page, FIELDS, [
    {
      op: "replace",
      path: ["video"],
      value: {
        path: VIDEO,
        mimeType: "video/webm",
        width: 320,
        height: 180,
        duration: 1,
        poster: { path: POSTER, ...METADATA },
      },
    },
    {
      op: "file",
      path: ["video"],
      filePath: VIDEO,
      value: `data:video/webm;base64,${clip}`,
      remote: false,
      metadata: { mimeType: "video/webm" },
    },
    {
      op: "file",
      path: ["video"],
      nestedFilePath: ["poster"],
      filePath: POSTER,
      value: `data:image/png;base64,${poster}`,
      remote: false,
      metadata: METADATA,
    },
  ]);

  await page.goto("/val/validate");
  const studio = page.locator("#val-shadow-root");
  await studio.getByRole("button", { name: "Check everything" }).click();
  const row = studio.getByRole("listitem").filter({
    hasText: "this one is still a local file",
  });
  await expect(row).toHaveCount(1, { timeout: 60_000 });
  await row.getByRole("button", { name: "Fix" }).click();
  await expect(
    row.getByText(/Uploads clip_00000\.webm and 1 more file when published/),
  ).toBeVisible({ timeout: 30_000 });

  const peeked = await peek(page, `${FIELDS}?p="video"`);
  const value =
    typeof peeked === "object" && peeked !== null && "data" in peeked
      ? peeked.data
      : undefined;
  expect(value).toMatchObject({
    path: expect.stringMatching(/^https:\/\/.+public\/val\/clip_00000\.webm$/),
    poster: {
      path: expect.stringMatching(
        /^https:\/\/.+public\/val\/clip-poster_00000\.png$/,
      ),
    },
  });
  const ops = await fileOps(page);
  expect(ops.filter(([, remote]) => remote)).toHaveLength(2);

  const published = await publishAll(page, "Upload a local video");
  expect(published.status, published.message ?? "").toBe("published");
  const state = await mock.state();
  for (const name of ["clip_00000.webm", "clip-poster_00000.png"]) {
    expect(
      state.remoteFiles.some((file) => file.includes(`public/val/${name}`)),
      `${name} was not moved to remote storage`,
    ).toBe(true);
  }
});

test("a video set entry is renamed to its video's ref, with its poster", async ({
  page,
}) => {
  const VIDEOS = "/content/remoteVideos.val.ts";
  const VIDEO = "/public/remote-videos/clip_00000.webm";
  const POSTER = "/public/remote-videos/clip-poster_00000.png";
  await openHttpStudio(page);
  const clip = fs.readFileSync(CLIP).toString("base64");
  const poster = fs.readFileSync(IMAGE).toString("base64");
  await writePatch(page, VIDEOS, [
    {
      op: "add",
      path: [VIDEO],
      value: {
        mimeType: "video/webm",
        width: 320,
        height: 180,
        duration: 1,
        alt: null,
        poster: { path: POSTER, ...METADATA },
      },
    },
    {
      op: "file",
      path: [VIDEO],
      filePath: VIDEO,
      value: `data:video/webm;base64,${clip}`,
      remote: false,
      metadata: { mimeType: "video/webm" },
    },
    {
      op: "file",
      path: [VIDEO],
      nestedFilePath: ["poster"],
      filePath: POSTER,
      value: `data:image/png;base64,${poster}`,
      remote: false,
      metadata: METADATA,
    },
  ]);

  await page.goto("/val/validate");
  const studio = page.locator("#val-shadow-root");
  await studio.getByRole("button", { name: "Check everything" }).click();
  const row = studio.getByRole("listitem").filter({
    hasText: "this one is still a local file",
  });
  await expect(row).toHaveCount(1, { timeout: 60_000 });
  await row.getByRole("button", { name: "Fix" }).click();
  await expect(
    row.getByText(/Uploads clip_00000\.webm and 1 more file when published/),
  ).toBeVisible({ timeout: 30_000 });

  const peeked = await peek(page, VIDEOS);
  const source =
    typeof peeked === "object" && peeked !== null && "data" in peeked
      ? peeked.data
      : undefined;
  const entries = Object.entries(
    typeof source === "object" && source !== null ? source : {},
  );
  expect(entries).toHaveLength(1);
  const [[key, entry]] = entries;
  expect(key).toMatch(/^https:\/\/.+public\/remote-videos\/clip_00000\.webm$/);
  expect(entry).toMatchObject({
    poster: {
      path: expect.stringMatching(
        /^https:\/\/.+public\/remote-videos\/clip-poster_00000\.png$/,
      ),
    },
  });

  const published = await publishAll(page, "Upload a local video set entry");
  expect(published.status, published.message ?? "").toBe("published");
  const state = await mock.state();
  for (const name of ["clip_00000.webm", "clip-poster_00000.png"]) {
    expect(
      state.remoteFiles.some((file) =>
        file.includes(`public/remote-videos/${name}`),
      ),
      `${name} was not moved to remote storage`,
    ).toBe(true);
  }
});

test.afterEach(async ({ page }) => {
  await discardAll(page).catch(() => undefined);
});
