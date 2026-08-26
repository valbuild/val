import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  chainLength,
  clearPatchChain,
  closeNavPanel,
  discardAll,
  expandRow,
  openNavPanel,
  openSiteMap,
  openStudio,
} from "./studio";

/**
 * Media: `s.images()`, `s.files()`, `s.image()` and `s.file()`.
 *
 * This feature has had more bugs than any other in the Studio, and every one of
 * them was invisible to the unit suite because the failure was always the same
 * shape: the patch is right, the server has the bytes, and the editor is looking
 * at a broken image or a stack trace. So the assertions here are about what a
 * browser can see — a decoded tile, a ref in the directory the schema names, a
 * field that renders at all.
 *
 * The fixtures are in `examples/next/content/`:
 *
 * - `mediaFixtures.val.ts`  `s.images({ directory: "/public/test/subdir" })`
 * - `fileGallery.val.ts`    `s.files({ directory: "/public/test/files" })`
 * - `mediaFields.val.ts`    `s.image()`, `s.image({ directory })`,
 *                           `s.image(gallery)`, `s.file()`, and the same inside
 *                           a union
 *
 * Each gallery ships ONE committed entry, so "can I see what is already there"
 * is covered by the repo rather than by a test that uploads first.
 */

const IMAGE = "e2e/fixtures/blue-8x8.png";
const OTHER_IMAGE = "e2e/fixtures/green-8x8.png";
const FILE = "e2e/fixtures/note.txt";

/** The gallery/field picker — never the AI chat's, which is the `multiple` one. */
function picker(studio: Locator): Locator {
  return studio.locator('input[type="file"]:not([multiple])');
}

/** The source at a module, straight from the store. */
function moduleSource(page: Page, moduleFilePath: string): Promise<unknown> {
  return page.evaluate((mfp) => {
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
    return peek.status === "ready" ? peek.data : peek.status;
  }, moduleFilePath);
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

test.beforeEach(async ({ request }) => {
  await clearPatchChain(request);
});

test.describe("the Media section", () => {
  /**
   * Galleries were unreachable from the nav entirely.
   *
   * `collectMediaModules` removes them from the explorer tree on the grounds
   * that they belong under Media — and `enrichNavMenuData` rebuilt the nav data
   * without carrying `media` across, so Media never rendered. Neither place, and
   * the only way to open a gallery was to know its URL.
   */
  test("lists the galleries, so they can be opened at all", async ({
    page,
  }) => {
    await openStudio(page);
    const studio = page.locator("#val-shadow-root");

    await expect(
      studio.getByRole("button", { name: "Media", exact: true }),
    ).toBeVisible();

    // Labelled by directory, which is the unit an editor thinks in.
    await studio.getByRole("button", { name: "Media", exact: true }).click();
    await expect(
      studio.getByTitle("/content/mediaFixtures.val.ts"),
    ).toBeVisible();
    await expect(
      studio.getByTitle("/content/fileGallery.val.ts"),
    ).toBeVisible();
  });

  /**
   * Opening one file, which is where source paths were being built by hand.
   *
   * A gallery is a record keyed by file path, so its keys contain dots — and a
   * module path segment has to be JSON-quoted. Two hand-rolled path builders
   * appended the raw key at the module root, which parses as one segment right
   * up until the key has a `.` in it: `?p=/public/test/subdir/red-8x8_bfbd0.png`
   * splits into `/public/test/subdir/red-8x8_bfbd0` and `png`, and the studio
   * reported the module as not found. Every other key in the project — object
   * fields, ordinary record keys, route keys — has no dot, so nothing else ever
   * showed it.
   *
   * The canvas closing is the other half: picking a file is a decision to go and
   * edit it, and in the fields view the canvas column was covering the thing
   * that had just been picked.
   */
  /**
   * Uploading from the panel, which needs to know where.
   *
   * The button used to look up a gallery by the current selection and call a
   * handler the app never passed — so it did nothing, ever, and would have
   * guessed the destination even if it had. A project can have several galleries
   * with different directories, one taking images and the next taking anything,
   * so the panel asks; the gallery it names does the upload, because that is
   * where knowing how to build the ref and the patch lives.
   */
  test("asks which gallery to upload into, and opens it there", async ({
    page,
  }) => {
    await openStudio(page);
    const studio = await openNavPanel(page, "Media");

    await studio.getByRole("button", { name: /Upload/ }).click();
    // Both galleries, by the directory files will land in and what it takes.
    const target = studio.getByRole("menuitem", { name: /test\/subdir/ });
    await expect(
      target,
      "the upload menu did not offer the galleries by directory",
    ).toBeVisible();
    // Served paths, so the row reads the way a URL to the file will.
    await expect(target).not.toContainText("/public");
    await expect(target).toContainText("Images");
    await expect(
      studio.getByRole("menuitem", { name: /Files/ }),
      "the menu did not say which gallery takes non-images",
    ).toBeVisible();

    await target.click();
    // It opens the gallery it named — the upload itself happens there, and the
    // file dialog it raises is not something a test can drive.
    await expect
      .poll(() => page.url(), { timeout: 20000 })
      .toContain("/content/mediaFixtures.val.ts");
  });

  test("opens one file, and leaves the canvas to do it", async ({ page }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "/");
    await closeNavPanel(studio, "Pages");
    await studio.getByRole("button", { name: /Open the canvas/ }).click();
    await expect(
      studio.getByRole("button", { name: "Fit page to screen" }),
    ).toBeVisible();

    await openNavPanel(page, "Media");
    await studio.getByTitle("/content/mediaFixtures.val.ts").click();
    const file = studio.getByRole("button", { name: /red-8x8_/ });
    await expect(file).toBeVisible({ timeout: 30000 });
    await file.click();

    // The key, quoted: a `p` that splits into two segments resolves to nothing.
    await expect
      .poll(() => new URL(page.url()).searchParams.get("p"), {
        message: "the file's module path never reached the URL",
        timeout: 10000,
      })
      .toBe('"/public/test/subdir/red-8x8_bfbd0.png"');

    await expect(
      studio.getByText(/not found/i),
      "the file's path did not resolve to anything",
    ).toHaveCount(0);
    await expect(
      studio.getByRole("button", { name: "Fit page to screen" }),
      "the canvas stayed open over the file that was just picked",
    ).toHaveCount(0);
  });
});

test.describe("an s.images() gallery in a non-default directory", () => {
  const MODULE = "/content/mediaFixtures.val.ts";

  test("shows the entry it already has", async ({ page }) => {
    await openStudio(page, `/val/~${MODULE}`);
    const studio = page.locator("#val-shadow-root");
    const tile = studio.locator('img[src*="red-8x8_"]');

    await expect(tile).toHaveCount(1);
    // Published, so it is served from the committed path with no patch id.
    await expect(tile).toHaveAttribute("src", /^\/test\/subdir\//);
    await expect
      .poll(() => tile.evaluate((i) => (i as HTMLImageElement).naturalWidth))
      .toBe(8);
  });

  test("uploads into the directory the schema names, and the tile renders", async ({
    page,
  }) => {
    await openStudio(page, `/val/~${MODULE}`);
    const studio = page.locator("#val-shadow-root");
    await picker(studio).first().setInputFiles(IMAGE);

    // The ref, which is the bug that started this: the gallery used to fall back
    // to `/public/val` when the schema named somewhere else.
    await expect
      .poll(() => uploadedRefs(page), { timeout: 30_000 })
      .toEqual(["/public/test/subdir/blue-8x8_8b441.png"]);

    const tile = studio.locator('img[src*="blue-8x8_"]');
    await expect(tile).toHaveCount(1);
    // Unpublished, so it MUST come from the patch — the committed path has no
    // file behind it yet, and `next dev` answers that path with the app's HTML,
    // so only decoding it can tell the difference.
    await expect(tile).toHaveAttribute("src", /\/api\/val\/files\/.*patch_id=/);
    await expect
      .poll(() => tile.evaluate((i) => (i as HTMLImageElement).naturalWidth), {
        timeout: 20_000,
        message: "the uploaded tile did not decode",
      })
      .toBe(8);

    await discardAll(page);
    await expect.poll(() => chainLength(page)).toBe(0);
  });
});

test.describe("an s.files() gallery", () => {
  const MODULE = "/content/fileGallery.val.ts";

  test("uploads a non-image into its own directory", async ({ page }) => {
    await openStudio(page, `/val/~${MODULE}`);
    const studio = page.locator("#val-shadow-root");
    await picker(studio).first().setInputFiles(IMAGE);

    await expect
      .poll(() => uploadedRefs(page), { timeout: 30_000 })
      .toEqual(["/public/test/files/blue-8x8_8b441.png"]);
    // `s.files()` records only a mime type; there is no width to get wrong.
    await expect
      .poll(async () => JSON.stringify(await moduleSource(page, MODULE)))
      .toContain("image/png");

    await discardAll(page);
    await expect.poll(() => chainLength(page)).toBe(0);
  });
});

test.describe("single media fields", () => {
  const MODULE = "/content/mediaFields.val.ts";

  /**
   * Both field components crashed the Studio for a field with no value: a
   * `useMemo` below their `loading` guards meant the render after the guard ran
   * more hooks than the one before it.
   */
  for (const field of ["image", "imageInSubdir", "fromGallery", "file"]) {
    test(`renders the empty ${field} field instead of a stack trace`, async ({
      page,
    }) => {
      await openStudio(page, `/val/~${MODULE}?p=%22${field}%22`);
      const studio = page.locator("#val-shadow-root");
      await expect(picker(studio).first()).toBeAttached();
      await expect(studio.locator("text=encountered an error")).toHaveCount(0);
    });
  }

  test("s.image() with no directory stores under /public/val", async ({
    page,
  }) => {
    await openStudio(page, `/val/~${MODULE}?p=%22image%22`);
    const studio = page.locator("#val-shadow-root");
    await picker(studio).first().setInputFiles(IMAGE);

    await expect
      .poll(() => uploadedRefs(page), { timeout: 30_000 })
      .toEqual(["/public/val/blue-8x8_8b441.png"]);
    await discardAll(page);
    await expect.poll(() => chainLength(page)).toBe(0);
  });

  /**
   * The field's OWN directory option. `ImageField` only ever read the directory
   * of a referenced module, so this silently wrote to `/public/val` — outside the
   * directory the schema allows, which then failed validation.
   */
  test("s.image({ directory }) stores where the field says", async ({
    page,
  }) => {
    await openStudio(page, `/val/~${MODULE}?p=%22imageInSubdir%22`);
    const studio = page.locator("#val-shadow-root");
    await picker(studio).first().setInputFiles(OTHER_IMAGE);

    await expect
      .poll(() => uploadedRefs(page), { timeout: 30_000 })
      .toEqual(["/public/test/fields/green-8x8_24c3f.png"]);
    await discardAll(page);
    await expect.poll(() => chainLength(page)).toBe(0);
  });

  /** A gallery-backed field stores in the GALLERY's directory. */
  test("s.image(gallery) stores in the gallery's directory", async ({
    page,
  }) => {
    await openStudio(page, `/val/~${MODULE}?p=%22fromGallery%22`);
    const studio = page.locator("#val-shadow-root");
    await picker(studio).first().setInputFiles(IMAGE);

    await expect
      .poll(() => uploadedRefs(page), { timeout: 30_000 })
      .toEqual(["/public/test/subdir/blue-8x8_8b441.png"]);
    await discardAll(page);
    await expect.poll(() => chainLength(page)).toBe(0);
  });

  test("s.file() uploads a non-image", async ({ page }) => {
    await openStudio(page, `/val/~${MODULE}?p=%22file%22`);
    const studio = page.locator("#val-shadow-root");
    await picker(studio).first().setInputFiles(FILE);

    await expect
      .poll(() => uploadedRefs(page), { timeout: 30_000 })
      .toEqual(["/public/val/note_7dae5.txt"]);
    await discardAll(page);
    await expect.poll(() => chainLength(page)).toBe(0);
  });
});
