import { expect, test, type Page, type Request } from "@playwright/test";
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
 * An image in REMOTE storage, by every way the Studio has of putting one there
 * -- each held to the same four checks.
 *
 * Remote is what a hosted project has: the Val app refuses to start without
 * `files: { remote: true }`, so every image there is remote. And it is what
 * survives a proposal: a proposal's address serves its remote files, but not a
 * local file it saved (valbuild/home `docs/proposals.md`, "Not yet: binary files
 * a proposal saves").
 *
 * The ways in were checked separately, and differently, which is how the
 * assistant's went wrong unnoticed: it stored its images under repo paths
 * while filing their bytes as remote, so the editor saw a broken image. A new
 * way of adding an image belongs in {@link WAYS_IN}, where it gets every check
 * below rather than the ones its author thought of.
 */

const GALLERY = "/content/remoteImages.val.ts";
const FIELDS = "/content/remoteFields.val.ts";
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
  /** The module the image ends up in, and where it is shown. */
  module: string;
  /** The directory under `/public` its ref names. */
  dir: string;
  /**
   * How its bytes reach the content service: uploaded from the browser, or
   * MOVED from the image attached in the chat -- a pointer at the object the
   * session file already is, which nothing should turn into a download and an
   * upload again.
   */
  arrives: "upload" | "session-file";
  /**
   * For an image moved from the chat: whether the Studio downloads it while
   * adding it. Only to hash it, and only when the content service did not say
   * what the hash is.
   */
  downloads?: boolean;
  /** Put {@link IMAGE} there, starting from a fresh page. */
  add(page: Page): Promise<void>;
};

/** The assistant's turn: one tool call, which has to succeed. */
async function assistantAdds(
  page: Page,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  await openChatStudio(page);
  await attachImage(page, IMAGE);
  await mock.aiScript({
    steps: [{ type: "tool", name, arguments: args }],
    response: "Done.",
  });
  await send(page, "Use the image I attached");
  const [call] = await toolCalls(1);
  okResult(call);
}

/**
 * What the assistant writes for an attached image: the session key, and a
 * repo path as a model names one. The Studio makes the ref.
 */
function sessionImage(filePath: string) {
  return {
    key: "{{imageKey:0}}",
    filePath,
    _type: "ai_session_file",
    _tag: "image",
    alt: "A blue square",
  };
}

const WAYS_IN: WayIn[] = [
  {
    name: "the gallery's Upload button",
    module: GALLERY,
    dir: "/public/remote-images/",
    arrives: "upload",
    async add(page) {
      await openHttpStudio(page, `/val/~${GALLERY}`);
      await uploadWhenReady(page.locator("#val-shadow-root"), IMAGE);
    },
  },
  {
    name: "the assistant, into the gallery",
    module: GALLERY,
    dir: "/public/remote-images/",
    arrives: "session-file",
    downloads: false,
    async add(page) {
      await assistantAdds(page, "add_session_image_to_gallery", {
        image_key: "{{imageKey:0}}",
        module_file_path: GALLERY,
        file_path: "/public/remote-images/ai-added.png",
        alt: "A blue square",
      });
    },
  },
  {
    // A content service from before `from-session-file` handed back the
    // hash: the Studio reads the bytes back to hash them, and still uploads
    // nothing.
    name: "the assistant, into the gallery, with no hash from the service",
    module: GALLERY,
    dir: "/public/remote-images/",
    arrives: "session-file",
    downloads: true,
    async add(page) {
      await mock.aiSessionSha256(false);
      await assistantAdds(page, "add_session_image_to_gallery", {
        image_key: "{{imageKey:0}}",
        module_file_path: GALLERY,
        file_path: "/public/remote-images/ai-unhashed.png",
        alt: "A blue square",
      });
    },
  },
  {
    name: "the image field's picker",
    module: FIELDS,
    dir: "/public/val/",
    arrives: "upload",
    async add(page) {
      await openHttpStudio(page, `/val/~${FIELDS}?p=%22image%22`);
      const picker = page
        .locator("#val-shadow-root")
        .locator('input[id^="img_input:"]')
        .first();
      // Disabled until there are remote settings to build a ref from.
      await expect(picker).toBeEnabled({ timeout: 30_000 });
      await picker.setInputFiles(IMAGE);
    },
  },
  {
    name: "the assistant, into an image field",
    module: FIELDS,
    dir: "/public/val/",
    arrives: "session-file",
    downloads: false,
    async add(page) {
      await assistantAdds(page, "create_patch", {
        module_file_path: FIELDS,
        patch: [
          {
            op: "replace",
            path: ["image"],
            value: sessionImage("/public/val/ai-hero.png"),
          },
        ],
      });
    },
  },
  {
    name: "the assistant, into rich text",
    module: FIELDS,
    dir: "/public/val/",
    arrives: "session-file",
    downloads: false,
    async add(page) {
      await assistantAdds(page, "create_patch", {
        module_file_path: FIELDS,
        patch: [
          {
            op: "replace",
            path: ["body"],
            value: [
              {
                tag: "p",
                children: [
                  {
                    tag: "img",
                    src: sessionImage("/public/val/ai-inline.png"),
                  },
                ],
              },
            ],
          },
        ],
      });
    },
  },
];

/**
 * The image named `filename`, on its module's own page, decodes -- and was
 * asked for as a REMOTE file, which is what it is.
 */
async function imageDecodes(
  page: Page,
  module: string,
  filename: string,
  message: string,
) {
  await page.goto(`/val/~${module}`);
  const image = page
    .locator("#val-shadow-root")
    .locator(`img[src*="${filename}"]`)
    .first();
  await expect(image, `${message}: no image`).toBeAttached({
    timeout: 30_000,
  });
  // Asked for as local, a remote file is not found: what the assistant's
  // images were, stored under a repo path.
  await expect(image).toHaveAttribute("src", /remote=true/);
  // A broken image, an HTML page in its place and a 404 all leave this at 0.
  await expect
    .poll(() => image.evaluate((i) => (i as HTMLImageElement).naturalWidth), {
      timeout: 20_000,
      message,
    })
    .toBe(8);
}

for (const way of WAYS_IN) {
  test(`added by ${way.name}: stored remote, shown, and still shown once published`, async ({
    page,
  }) => {
    // Every request for file bytes while the image is being added: nothing
    // on screen shows one yet, so any is the Studio reading it back.
    const reads: string[] = [];
    const onRequest = (request: Request) => {
      if (request.url().includes("/api/val/files/")) reads.push(request.url());
    };
    page.on("request", onRequest);
    await way.add(page);
    page.off("request", onRequest);
    if (way.downloads !== undefined) {
      expect(
        reads.length > 0,
        way.downloads
          ? "the image was not read back to hash it"
          : `the image was downloaded, though the service sent its hash: ${reads.join(", ")}`,
      ).toBe(way.downloads);
    }

    // 1. Its bytes reached the content service once, as a remote file, the
    //    way this way in sends them. (On the wire a remote file is filed by its
    //    `/public` path; the ref travels beside it.)
    await expect
      .poll(async () => (await mock.state()).patchFiles.length, {
        timeout: 30_000,
        message: "no file reached the service",
      })
      .toBe(1);
    const [file] = (await mock.state()).patchFiles;
    expect(file).toMatchObject({ remote: true, source: way.arrives });
    const { filePath } = file;
    expect(filePath.startsWith(way.dir), filePath).toBe(true);
    const filename = filePath.slice(filePath.lastIndexOf("/") + 1);

    // 2. Shown before publishing, when the bytes are only in the patch.
    await imageDecodes(
      page,
      way.module,
      filename,
      "the new image did not decode",
    );

    // 3. Published to remote storage, not into the commit.
    const published = await publishAll(page, `Adding by ${way.name}`);
    expect(published.status, published.message ?? "").toBe("published");
    const state = await mock.state();
    expect(state.remoteFiles).toEqual([
      expect.stringContaining(`${way.dir.slice(1)}${filename}`),
    ]);
    // ...and the module that was committed names it by its remote ref, not by
    //    a repo path that nothing will ever serve.
    expect(await mock.committedSource(way.module)).toMatch(
      new RegExp(
        `https://remote\\.val\\.build/file/p/[^"'\\s]*${way.dir}${filename.replace(".", "\\.")}`,
      ),
    );
    expect(
      state.repoOverlay.filter((repoPath) => repoPath.includes(filename)),
      "the image ended up in the repo despite being remote",
    ).toEqual([]);

    // 4. Still shown once published, across a reload.
    await imageDecodes(
      page,
      way.module,
      filename,
      "the published image did not decode",
    );
  });
}
