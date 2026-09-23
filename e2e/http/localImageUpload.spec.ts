import { expect, test, type Locator } from "@playwright/test";
import { readFile } from "fs/promises";
import { discardAll, mock, openHttpStudio, sessionCookie } from "./httpMode";

/**
 * A PLAIN LOCAL IMAGE, uploaded from the Studio in http mode and read back
 * before it is published.
 *
 * This is the most ordinary thing an editor does with media, and until this
 * file it was the one media journey http mode did not cover. The two http
 * tests that read a draft file back both reach it by a side road:
 * `aiChat.spec.ts` uploads through the AI session-file route, where the content
 * service copies the bytes and the browser never holds them, and
 * `remoteFiles.spec.ts` uploads a REMOTE file, which builds a different ref and
 * takes a different branch on the way out. Neither exercises
 * `/direct-file-upload-settings` → browser upload → local ref → read back.
 *
 * What it is here to catch, from a real incident: an editor uploaded an image,
 * the Studio showed a broken tile, and the image appeared the moment the change
 * was PUBLISHED. The cause was the encoding of `value` in `PUT /files`. It
 * carried a `data:` URL for a `patch` file and plain base64 for a `repo` one,
 * two encodings in one field; `home#38` made both base64 and val#563 stopped
 * unwrapping the data URL. Paired changes, and either half shipped alone is
 * silently wrong in exactly this way -- the published read goes through the
 * `repo` branch, which never changed, so only the DRAFT read breaks and it
 * looks like "draft images do not work".
 *
 * `homeWireContract.test.ts` pins that encoding directly and cheaply. This
 * covers the journey around it: the bytes really do leave the browser, reach
 * the content service, and come back through the endpoint the tile asks for.
 *
 * The fixture is `content/mediaFields.val.ts`'s `image` field -- `s.image()`
 * with no directory and no gallery, starting `null`, which is the shape the
 * incident had.
 */

const MODULE = "/content/mediaFields.val.ts";
const IMAGE = "e2e/fixtures/blue-8x8.png";
/** What `createFilename` makes of those bytes: name, first 5 hex of the sha. */
const REF = "/public/val/blue-8x8_8b441.png";

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

/** The field's picker — never the AI chat's, which is the `multiple` one. */
function picker(studio: Locator): Locator {
  return studio.locator('input[type="file"]:not([multiple])');
}

test.beforeEach(async () => {
  await mock.reset();
});

test("uploads a local image, and the editor can see it before publishing", async ({
  page,
}) => {
  // `?p=%22image%22` scopes to the plain field: this module also has one with
  // its own directory and a gallery-backed one, and they store elsewhere.
  await openHttpStudio(page, `/val/~${MODULE}?p=%22image%22`);
  const studio = page.locator("#val-shadow-root");

  await expect(picker(studio).first()).toBeAttached({ timeout: 30_000 });
  await picker(studio).first().setInputFiles(IMAGE);

  const tile = studio.locator('img[src*="blue-8x8_"]');
  await expect(tile, "the upload never produced a tile").toHaveCount(1, {
    timeout: 30_000,
  });

  /*
   * Unpublished, so the bytes can ONLY come out of the patch. The committed
   * path has no file behind it yet and `next dev` answers that path with the
   * app's HTML, so a src check alone would pass against a 404-shaped failure.
   */
  await expect(tile).toHaveAttribute("src", /\/api\/val\/files\/.*patch_id=/);

  /*
   * `naturalWidth` is the assertion that can tell, and it is why this is an
   * e2e rather than a request check: a broken image, an HTML page served in
   * its place and a 404 all leave it at 0. Only bytes a browser decoded as an
   * 8x8 PNG make it 8.
   */
  await expect
    .poll(() => tile.evaluate((i) => (i as HTMLImageElement).naturalWidth), {
      timeout: 20_000,
      message: "the uploaded tile did not decode",
    })
    .toBe(8);

  // And the same URL, byte for byte against what was uploaded. A length check
  // would not do: the encoding bug this guards produced *some* bytes, and
  // "an image came back" is what the broken tile looked like.
  const src = await tile.getAttribute("src");
  expect(src).toBeTruthy();
  const served = await page.request.get(src!);
  expect(served.status()).toBe(200);
  expect(await served.body()).toEqual(await readFile(IMAGE));

  // And the ref it was stored under, which says the upload went to the
  // default directory rather than wherever the last schema read said.
  expect(src).toContain(REF.slice(1));

  await discardAll(page);
});
