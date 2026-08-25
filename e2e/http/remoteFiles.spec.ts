import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  chainLength,
  discardAll,
  mock,
  openHttpStudio,
  publishAll,
  sessionCookie,
} from "./httpMode";

/**
 * Remote files: uploaded to Val's file host rather than committed to the repo.
 *
 * This cannot be tested in `fs` mode at all. A remote upload needs
 * `/remote/settings` to answer with a project id and a bucket, which comes from
 * the content service; the ref the Studio builds encodes those, and the bytes go
 * to the content host rather than to disk. Without a content service to talk to
 * there is nothing to test.
 *
 * The fixture is `content/remoteImages.val.ts` — a gallery, deliberately, so
 * that the example app can ship it. A single `s.image().remote()` field would
 * make `hasRemoteFileSchema` true for the whole project and every `fs`-mode
 * publish would then demand remote credentials a local checkout does not have.
 * The upload path being exercised is the same one either way: `ModuleGallery`
 * builds a remote ref with `createRemoteRef` and sends the bytes with
 * `remote: true`.
 */

const MODULE = "/content/remoteImages.val.ts";
const IMAGE = "e2e/fixtures/blue-8x8.png";
const OTHER_IMAGE = "e2e/fixtures/green-8x8.png";

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

/** The gallery's picker — never the AI chat's, which is the `multiple` one. */
function picker(studio: Locator): Locator {
  return studio.locator('input[type="file"]:not([multiple])');
}

/** Every `file` op path in the chain: where an upload decided to store itself. */
function uploadedRefs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = (
      window as unknown as {
        __VAL_STORES__: {
          system: {
            patchStore: {
              allRecords(): { patch: { op: string; filePath?: string }[] }[];
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
          .map((op) => op.filePath ?? ""),
      );
  });
}

test.beforeEach(async () => {
  await mock.reset();
});

test.describe("remote files", () => {
  /**
   * The gallery is reachable from the nav, not only from its URL.
   *
   * Galleries have been missing from the Media section before — `enrichNavMenuData`
   * rebuilt the nav without carrying `media` across — and a remote gallery is a
   * separate branch of that listing. Asserted here because the rest of this file
   * navigates straight to the module and would not notice.
   */
  test("is listed under Media", async ({ page }) => {
    await openHttpStudio(page);
    const studio = page.locator("#val-shadow-root");
    await studio.getByRole("button", { name: "Media", exact: true }).click();
    await expect(studio.getByTitle(MODULE)).toBeVisible();
  });

  /**
   * An upload, and the three things that make it remote rather than local.
   *
   * The ref is a URL on the remote host, not a repo path. The bytes reach the
   * content service flagged `remote`. And the tile the editor sees comes back
   * through `/api/val/files` with a patch id, because until the change is
   * published there is no remote object to fetch — the file exists only inside
   * the patch.
   */
  test("uploads to the content service, flagged remote, and the tile renders", async ({
    page,
  }) => {
    await openHttpStudio(page, `/val/~${MODULE}`);
    const studio = page.locator("#val-shadow-root");
    await picker(studio).first().setInputFiles(IMAGE);

    // A remote ref, not a repo path: `https://remote.val.build/file/p/...`, with
    // the project, bucket and hashes the content service handed out.
    const refs = await expect
      .poll(() => uploadedRefs(page), { timeout: 30_000 })
      .toHaveLength(1)
      .then(() => uploadedRefs(page));
    expect(refs[0]).toMatch(/^https:\/\/remote\.val\.build\/file\/p\//);
    expect(refs[0], "the ref does not name the schema's directory").toContain(
      "public/remote-images/blue-8x8_",
    );

    // The content service has the bytes, and they arrived as a remote upload.
    await expect
      .poll(async () => (await mock.state()).patchFiles.length, {
        timeout: 30_000,
        message: "the bytes never reached the content service",
      })
      .toBe(1);
    const [uploaded] = (await mock.state()).patchFiles;
    expect(uploaded.remote, "the upload was not flagged remote").toBe(true);
    expect(uploaded.type).toBe("image");
    expect(uploaded.bytes).toBeGreaterThan(0);

    // And the editor can see it. Unpublished, so it can only come from the patch.
    const tile = studio.locator('img[src*="blue-8x8_"]');
    await expect(tile).toHaveCount(1);
    await expect(tile).toHaveAttribute("src", /patch_id=/);
    await expect
      .poll(() => tile.evaluate((i) => (i as HTMLImageElement).naturalWidth), {
        timeout: 20_000,
        message: "the uploaded remote tile did not decode",
      })
      .toBe(8);
  });

  /**
   * Publishing moves the bytes out to remote storage rather than into the repo.
   *
   * The distinction the whole feature exists for: a committed remote image must
   * NOT appear in the commit's files, or the repository grows by every image ever
   * uploaded, which is the problem remote files solve.
   */
  test("publishing moves the file to remote storage, not into the commit", async ({
    page,
  }) => {
    await openHttpStudio(page, `/val/~${MODULE}`);
    const studio = page.locator("#val-shadow-root");
    await picker(studio).first().setInputFiles(IMAGE);
    await expect
      .poll(() => uploadedRefs(page), { timeout: 30_000 })
      .toHaveLength(1);

    const published = await publishAll(page, "Adding a remote image");
    expect(published.status, published.message ?? "").toBe("published");

    const state = await mock.state();
    expect(state.commits).toHaveLength(1);
    expect(
      state.remoteFiles,
      "the file was not moved to remote storage",
    ).toHaveLength(1);
    expect(state.remoteFiles[0]).toContain("public/remote-images/blue-8x8_");
    // The commit carries the module's source, and no image bytes.
    const committed = await mock.committedSource(MODULE);
    expect(
      committed,
      "the commit carried no source for the gallery",
    ).toBeTruthy();
    expect(committed).toContain("public/remote-images/blue-8x8_");
    expect(
      state.repoOverlay.filter((filePath) =>
        filePath.includes("remote-images"),
      ),
      "an image ended up in the repo despite being remote",
    ).toEqual([]);
  });

  /**
   * Deleting a remote entry.
   *
   * A gallery delete is a `remove` op plus a `file` op with a null value — the
   * shape that tells the server to forget the bytes as well as the record. Done
   * on a freshly uploaded entry rather than a committed one because that is the
   * case the editor hits: upload, look at it, change their mind.
   */
  test("deletes a remote entry it just uploaded", async ({ page }) => {
    await openHttpStudio(page, `/val/~${MODULE}`);
    const studio = page.locator("#val-shadow-root");
    await picker(studio).first().setInputFiles(OTHER_IMAGE);

    const tile = studio.locator('img[src*="green-8x8_"]');
    await expect(tile).toHaveCount(1);
    await expect
      .poll(() => tile.evaluate((i) => (i as HTMLImageElement).naturalWidth), {
        timeout: 20_000,
      })
      .toBe(8);

    // Delete lives in the file's properties dialog, behind a click on the tile —
    // and it stays disabled until the reference scan has finished, because
    // deleting a file something still points at is the mistake it guards.
    await tile.click();
    const remove = studio.getByRole("button", { name: "Delete", exact: true });
    await expect(remove).toBeEnabled({ timeout: 30_000 });
    await remove.click();

    await expect(tile, "the deleted tile is still on screen").toHaveCount(0);
    // The record is gone from the module the editor is looking at.
    await expect
      .poll(() =>
        page.evaluate((mfp) => {
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
          return peek.status === "ready"
            ? JSON.stringify(peek.data)
            : peek.status;
        }, MODULE),
      )
      .not.toContain("green-8x8_");

    await discardAll(page);
    await expect.poll(() => chainLength(page)).toBe(0);
  });
});
