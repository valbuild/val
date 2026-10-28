import { expect, test, type Page } from "@playwright/test";
import { mock, openHttpStudio, publishAll, sessionCookie } from "./httpMode";
import {
  attachImage,
  okResult,
  openChatStudio,
  send,
  toolCalls,
} from "./assistant";
import { uploadWhenReady } from "./galleryUpload";

/**
 * An image in a REMOTE gallery, by every way the Studio has of putting one
 * there -- each held to the same four checks.
 *
 * Remote is what a hosted project has: the Val app refuses to start without
 * `files: { remote: true }`, so every gallery there is remote. And it is what
 * survives a proposal: a proposal's address serves its remote files, but not a
 * local file it saved (valbuild/home `docs/proposals.md`, "Not yet: binary files
 * a proposal saves").
 *
 * The ways in were checked separately, and differently, which is how one of
 * them went wrong unnoticed: the assistant's gallery tool keyed the entry by a
 * repo path while filing its bytes as remote, so the editor saw a broken tile.
 * A new way of adding an image belongs in {@link WAYS_IN}, where it gets every
 * check below rather than the ones its author thought of.
 */

const MODULE = "/content/remoteImages.val.ts";
const IMAGE = "e2e/fixtures/blue-8x8.png";

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
  // The assistant is reached from the desktop top bar. See aiChat.spec.ts.
  viewport: { width: 1600, height: 1000 },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

type WayIn = {
  name: string;
  /** Put {@link IMAGE} in the gallery, starting from a fresh page. */
  add(page: Page): Promise<void>;
};

const WAYS_IN: WayIn[] = [
  {
    name: "the gallery's Upload button",
    async add(page) {
      await openHttpStudio(page, `/val/~${MODULE}`);
      await uploadWhenReady(page.locator("#val-shadow-root"), IMAGE);
    },
  },
  {
    name: "the assistant",
    async add(page) {
      await openChatStudio(page);
      await attachImage(page, IMAGE);
      await mock.aiScript({
        steps: [
          {
            type: "tool",
            name: "add_session_image_to_gallery",
            arguments: {
              image_key: "{{imageKey:0}}",
              module_file_path: MODULE,
              // A repo path, as a model names one: the Studio makes the ref.
              file_path: "/public/remote-images/ai-added.png",
              alt: "A blue square",
            },
          },
        ],
        response: "It is in the gallery now.",
      });
      await send(page, "Add this to the remote gallery");
      const [call] = await toolCalls(1);
      okResult(call);
    },
  },
];

/**
 * The gallery's tile for `filename`, on the gallery's own page, decodes -- and
 * was asked for as a REMOTE file, which is what it is.
 */
async function tileDecodes(page: Page, filename: string, message: string) {
  await page.goto(`/val/~${MODULE}`);
  const tile = page
    .locator("#val-shadow-root")
    .locator(`img[src*="${filename}"]`);
  await expect(tile, `${message}: no tile`).toHaveCount(1, {
    timeout: 30_000,
  });
  // Asked for as local, a remote file is not found: what the assistant's
  // gallery entries were, keyed by a repo path.
  await expect(tile).toHaveAttribute("src", /remote=true/);
  // A broken image, an HTML page in its place and a 404 all leave this at 0.
  await expect
    .poll(() => tile.evaluate((i) => (i as HTMLImageElement).naturalWidth), {
      timeout: 20_000,
      message,
    })
    .toBe(8);
}

for (const way of WAYS_IN) {
  test(`added by ${way.name}: stored remote, shown, and still shown once published`, async ({
    page,
  }) => {
    await way.add(page);

    // 1. Its bytes reached the content service as a remote file. (On the wire
    //    a remote file is filed by its `/public` path; the ref travels beside
    //    it.) Only remote files are counted: the assistant's image also arrives
    //    as a local file of the same patch, which it is read back from.
    await expect
      .poll(
        async () =>
          (await mock.state()).patchFiles.filter((file) => file.remote).length,
        { timeout: 30_000, message: "no remote file reached the service" },
      )
      .toBe(1);
    const [{ filePath }] = (await mock.state()).patchFiles.filter(
      (file) => file.remote,
    );
    expect(filePath).toMatch(/^\/public\/remote-images\//);
    const filename = filePath.slice(filePath.lastIndexOf("/") + 1);

    // 2. Shown before publishing, when the bytes are only in the patch.
    await tileDecodes(page, filename, "the new tile did not decode");

    // 3. Published to remote storage, not into the commit.
    const published = await publishAll(page, `Adding by ${way.name}`);
    expect(published.status, published.message ?? "").toBe("published");
    const state = await mock.state();
    expect(state.remoteFiles).toEqual([
      expect.stringContaining("public/remote-images/"),
    ]);
    // ...and the gallery that was committed is keyed by its remote ref, not by
    //    a repo path that nothing will ever serve.
    expect(await mock.committedSource(MODULE)).toMatch(
      new RegExp(
        `https://remote\\.val\\.build/file/p/[^"'\\s]*/public/remote-images/${filename.replace(".", "\\.")}`,
      ),
    );
    expect(
      state.repoOverlay.filter((filePath) =>
        filePath.includes("remote-images"),
      ),
      "an image ended up in the repo despite being remote",
    ).toEqual([]);

    // 4. Still shown once published, across a reload.
    await tileDecodes(page, filename, "the published tile did not decode");
  });
}
