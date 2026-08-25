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
 * The Studio, driven through its own UI.
 *
 * `studio.spec.ts` drives the store system directly — it proves the stores talk
 * to the server. This one clicks and types, which is the only thing that proves
 * the ~20 hooks between a field and a store are wired to each other. Those hooks
 * were rewritten wholesale when `ValSyncEngine` was removed, and their signatures
 * were kept identical so no component had to change; the risk that creates is
 * exactly the one a compiler cannot see, because everything still typechecks
 * whether or not a hook returns the right thing.
 *
 * ## Navigation is behind a panel
 *
 * The floating shell keeps the site map in a panel off the left rail rather
 * than always on screen, and expands nothing on mount — a real project has
 * sections with hundreds of rows. So reaching a page is: open the panel, open
 * the rows above it, click it. `openSiteMap` and `expandRow` do that, and the
 * clicks are the same ones an editor makes.
 *
 * ## Everything is inside a shadow root
 *
 * The SPA mounts into `#val-shadow-root`'s shadow DOM for CSS isolation.
 * Playwright pierces shadow roots automatically for CSS and role selectors, so
 * scoping a locator to `#val-shadow-root` reaches inside — but `document.
 * querySelector` from `page.evaluate` does not, which is why the helpers below go
 * through `.shadowRoot` explicitly.
 */

/** Open the Studio, and hand back the shadow root everything lives inside. */
async function studioRoot(page: Page): Promise<Locator> {
  await openStudio(page);
  return page.locator("#val-shadow-root");
}

/** The text inputs the Studio is currently showing, with their values. */
async function fieldValues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scope = document.getElementById("val-shadow-root")?.shadowRoot;
    if (!scope) return [];
    return [...scope.querySelectorAll("input,textarea")]
      .filter((el) => el.getAttribute("type") !== "file")
      .map((el) => (el as HTMLInputElement).value ?? "");
  });
}

test.beforeAll(async ({ request }) => {
  await clearPatchChain(request);
});

test.describe("the Studio, through its own UI", () => {
  /**
   * The nav tree is the widest read in the app: it is built from
   * `useShallowModulesAtPaths` + `useSchemas` + `useAllValidationErrors`, which
   * between them touch the source store, the schema store and the validation
   * store for the WHOLE project. If any of those three came back empty the tree
   * renders and shows nothing, which is a failure that looks like a working app.
   */
  test("renders the project's navigation from real content", async ({
    page,
  }) => {
    await studioRoot(page);
    const studio = await openSiteMap(page);
    // Routes discovered from the app's own route modules...
    await expect(
      studio.getByRole("button", { name: "blogs", exact: true }),
    ).toBeVisible();
    await expect(
      studio.getByRole("button", { name: "support", exact: true }),
    ).toBeVisible();
    // ...and record keys read out of source, which only appear if the source
    // store answered for those modules.
    await expandRow(studio, "blogs");
    await expect(
      studio.getByRole("button", { name: "blog-12", exact: true }),
    ).toBeVisible();
    await expandRow(studio, "support");
    await expect(
      studio.getByRole("button", { name: "getting-started", exact: true }),
    ).toBeVisible();

    // The non-router modules, which come from the schemas rather than from the
    // routers: a different read, and one that has its own panel.
    const dataPanel = await openNavPanel(page, "Data");
    await expect(
      dataPanel.getByRole("button", { name: "authors", exact: true }),
    ).toBeVisible();
    await expect(
      dataPanel.getByRole("button", { name: "handbook", exact: true }),
    ).toBeVisible();
  });

  /**
   * Navigating to a module and seeing its values is the whole read path end to
   * end: route -> `useSchemaAtPath` resolves the schema at the path ->
   * `useShallowSourceAtPath` reads the value -> the field renders it.
   */
  test("opens a module and shows its values", async ({ page }) => {
    await studioRoot(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "generic");
    await closeNavPanel(studio, "Pages");

    await expect
      .poll(() => fieldValues(page), {
        message: "the module's fields never showed their values",
      })
      .toContain("Generic");
    expect(await fieldValues(page)).toContain("Generic content in a textarea");
  });

  /**
   * Typing, which is the write path through the UI rather than through the
   * store: `useAddPatch` mints the patch, `PatchStore` applies it, and the field
   * shows the new value without being woken by its own keystroke.
   *
   * The chain length is asserted alongside the visible value because the two
   * failures look identical on screen: a field that shows what you typed because
   * it wrote a patch, and one that shows it because it is an uncontrolled input
   * that wrote nothing.
   */
  test("types into a field and writes exactly one patch", async ({ page }) => {
    await studioRoot(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "generic");
    await closeNavPanel(studio, "Pages");
    await expect.poll(() => fieldValues(page)).toContain("Generic");

    const before = await chainLength(page);
    const title = studio
      .locator("input")
      .filter({ hasNot: page.locator("[type=file]") })
      .first();
    await title.fill("Typed by e2e");
    // Blur, because a field commits on change and the assertion should not race
    // a debounce.
    await title.blur();

    await expect(title).toHaveValue("Typed by e2e");
    await expect
      .poll(() => chainLength(page), {
        message: "typing produced no patch, so the field wrote nothing",
      })
      .toBeGreaterThan(before);

    /**
     * Put the chain back, and it is not tidiness.
     *
     * The next test publishes whatever is pending, so a patch left here would be
     * committed by it — and the value it then restores would be THIS test's
     * text, not the fixture's. A test that quietly changes what the next one
     * considers "original" is how a suite ends up rewriting the repository one
     * run at a time.
     */
    await discardAll(page);
    await expect.poll(() => chainLength(page)).toBe(before);
  });

  /**
   * The publish gate, which is `usePublishSummary` over `system.publish`.
   *
   * In `fs` mode the button says "Save" and publishing writes the `.val.ts`
   * files, so a successful publish empties the chain: `fs` deletes the patches
   * and the store promotes the patched value to base — which is why the field
   * must still show the typed value afterwards. A publish that left the old text
   * on screen would be the reversed-order bug `system.publish` documents.
   */
  test("saves the pending change and keeps showing it", async ({ page }) => {
    await studioRoot(page);
    // Start from the committed state, whatever the tests before this one left.
    await discardAll(page);

    const studio = await openSiteMap(page);
    await expandRow(studio, "generic");
    await closeNavPanel(studio, "Pages");

    /**
     * The committed value, read from the store rather than off the screen.
     *
     * `peekBase` walks `baseSources`, so it answers what the SERVER has — which
     * is the thing this test has to put back. Reading the input instead would
     * work right up until a patch from another test was still pending, at which
     * point "the original" would be that test's text and the suite would rewrite
     * the fixture one run at a time. It did, once.
     */
    const committed = await page.evaluate(() => {
      const bag = window as unknown as {
        __VAL_STORES__: {
          system: {
            sourceStore: { peekBase(path: string): { data?: unknown } };
          };
        };
      };
      const seen = bag.__VAL_STORES__.system.sourceStore.peekBase(
        '/app/generic/[[...path]]/page.val.ts?p="/generic"."title"',
      );
      return typeof seen.data === "string" ? seen.data : null;
    });
    expect(committed, "could not read the committed title").not.toBeNull();

    const title = studio
      .locator("input")
      .filter({ hasNot: page.locator("[type=file]") })
      .first();
    // The field showing the committed value IS the readiness signal, and a
    // precise one: an input that merely EXISTS could be the search box.
    await expect(title).toHaveValue(committed as string);

    await typeAndSave(page, studio, title, "Saved by e2e");
    // The value stays after the chain empties. Promote-then-forget, in that
    // order — reversed, every published field would flash back to its
    // pre-publish text until the next source fetch landed.
    await expect(title).toHaveValue("Saved by e2e");

    /**
     * And put the fixture back.
     *
     * A publish in `fs` mode rewrites the app's `.val.ts` files on disk, and
     * those ARE tracked by git — unlike `.val/patches`, which is ignored. A
     * suite that leaves the working tree dirty is one people stop running.
     */
    await typeAndSave(page, studio, title, committed as string);
    await expect(title).toHaveValue(committed as string);
  });
});

/** Type a value into a field, publish it, and wait for the chain to empty. */
async function typeAndSave(
  page: Page,
  studio: Locator,
  field: Locator,
  value: string,
): Promise<void> {
  await field.fill(value);
  // Blur, because a field commits on change and the assertion should not race a
  // debounce.
  await field.blur();
  await expect
    .poll(() => chainLength(page), {
      message: `typing "${value}" produced no patch`,
    })
    .toBeGreaterThan(0);

  await studio.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => chainLength(page), {
      timeout: 30_000,
      message: "the chain never emptied, so the publish did not land",
    })
    .toBe(0);
}

/**
 * A media gallery (`s.images()`) upload, driven the way an editor does it.
 *
 * `studio.spec.ts` covers the same module at the STORE level — it builds the
 * gallery patch by hand and checks the server serves the bytes back, which is
 * what pins the `parentRef` directory bug. This one goes through
 * `ModuleGallery`'s own file input, `addAndUploadPatchWithFileOps` and the
 * two-phase upload, and then asks the one question neither of those can:
 *
 * **does the tile actually render?**
 *
 * That is not a cosmetic check. The URL a gallery tile points at is chosen from
 * `useFilePatchIds()`: a file the server has not committed has to be fetched as
 * `/api/val/files{path}?patch_id=...`, and a published one from its committed
 * path. Get the condition wrong and the store, the patch and the server are all
 * correct while the editor looks at a broken image — which is exactly what
 * happened: the gate was "is this patch unsaved" rather than "is it unpublished",
 * so the tile worked for the second before the write came back and then broke.
 *
 * `naturalWidth` is the assertion because it is the only one that can tell. A
 * present `src` and a 200 response both survive the bug: `next dev` answers the
 * uncommitted path with the app's HTML, so the request succeeds and the decode is
 * what fails.
 */
test.describe("a media gallery upload", () => {
  test("renders the tile it just uploaded", async ({ page }) => {
    await openStudio(page, "/val/~/content/media.val.ts");
    const studio = page.locator("#val-shadow-root");
    // `ModuleGallery`'s own hidden input — the one its Upload button clicks.
    const picker = studio.locator('input[type="file"]').first();
    await expect(picker).toBeAttached();

    await picker.setInputFiles("e2e/fixtures/probe-2x2.png");

    // The ref is `Internal.createFilename`'s — the fixture's basename plus the
    // first five hex of its content hash — so it is stable for these bytes.
    const tile = studio.locator('img[src*="probe-2x2_"]');
    await expect(tile).toHaveCount(1, { timeout: 30_000 });

    // The patch exists, so this is an upload and not a no-op that left the
    // gallery showing its committed entries.
    await expect.poll(() => chainLength(page)).toBeGreaterThan(0);

    // Decoded, not merely requested. See the note above.
    await expect
      .poll(
        async () =>
          tile.evaluate((img) => (img as HTMLImageElement).naturalWidth),
        {
          timeout: 20_000,
          message:
            "the uploaded tile did not decode, so its URL points at bytes the server does not have there",
        },
      )
      .toBe(2);

    // And the draft URL is the reason it decoded, rather than the fixture having
    // been committed by an earlier run.
    await expect(tile).toHaveAttribute("src", /\/api\/val\/files\/.*patch_id=/);

    await discardAll(page);
    await expect.poll(() => chainLength(page)).toBe(0);
  });
});
