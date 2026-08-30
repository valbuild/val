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
   *
   * One value carries that property. There used to be a second assertion here,
   * on the generic page's `content` textarea, and it went stale when that page
   * was reshaped into a `sections` array of inline union members. What is left
   * at module level is the title: `url` is a route selector and `sections` is a
   * list, so neither is a text input. The inline rows the new fixture exists to
   * show are NOT covered by anything yet — worth a spec of their own rather than
   * a guess bolted onto this one.
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
   * A word typed a character at a time arrives, whole, on the server.
   *
   * `fill()` above sets the value in one event; this types it, which is the case
   * a real editor produces.
   *
   * ## The coalescing claim moved, on purpose
   *
   * This test used to assert that five keystrokes produced exactly ONE patch —
   * the regression being a field that wrote per keystroke, so a paragraph left a
   * few hundred patches in the chain, enough to slow every stat, make the
   * publish a wall of one-character diffs, and eventually break the request that
   * reads the chain back (see `chunkPatchIds`).
   *
   * That claim is about which timer the field arms, and it cannot be made
   * honestly from here. It needed 60ms between keystrokes against a 250ms
   * debounce — 190ms of slack, with every keystroke a CDP round trip on a box
   * also running `next dev`, Vite and Chromium — so one stall over 190ms split
   * the burst and failed the run for a reason that had nothing to do with the
   * field. It now lives in `StringField.test.tsx` ("a burst of keystrokes is one
   * write, carrying the last value"), on a fake clock where the margin is exact.
   *
   * What is left here is the half only a browser can show: real keystrokes into
   * the real field put the typed value on screen AND on the server.
   */
  test("types a word a key at a time, and it reaches the server", async ({
    page,
    request,
  }) => {
    await studioRoot(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "generic");
    await closeNavPanel(studio, "Pages");
    await expect.poll(() => fieldValues(page)).toContain("Generic");

    const title = studio
      .locator("input")
      .filter({ hasNot: page.locator("[type=file]") })
      .first();
    await title.click();
    await title.fill("");
    for (const key of "Typed".split("")) {
      await title.press(key);
    }
    await title.blur();

    // What the editor sees.
    await expect(title).toHaveValue("Typed");
    // And that it left the browser. A field that wrote only locally renders
    // exactly like one that saved — which is the shape of the four AI write
    // paths that reported success and persisted nothing — so the value has to
    // be read back out of the server, not out of the page or the chain.
    await expect
      .poll(
        async () => {
          const res = await request.get(
            "/api/val/patches?exclude_patch_ops=false",
          );
          if (!res.ok())
            return `the server refused the request: ${res.status()}`;
          const body = (await res.json()) as {
            patches: { patch: { value?: unknown }[] }[];
          };
          return body.patches.some((entry) =>
            entry.patch.some((op) => op.value === "Typed"),
          );
        },
        { message: "what was typed never reached the server" },
      )
      .toBe(true);
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

/**
 * Reordering an array by dragging, and what has to be true afterwards.
 *
 * The bug this pins: one drag on `/content/handbook.val.ts` left the list
 * permanently disabled behind a spinner. `ArrayFields` gated `disabled` on
 * `clientSideOnly`, which was computed inside `useShallowSourceAtPath`'s memo —
 * whose inputs are all source-shaped — so saving the patch, which moves the chain
 * and not source, never refreshed it. The row's drag handle is a
 * `<button disabled>`, so a single reorder disabled reordering, and it stayed
 * that way until some unrelated edit happened to move source at that path.
 *
 * Only a browser can see this. The patch is correct, source is correct, and the
 * order ends up right — what is broken is the control, one interaction later. So
 * the assertion that matters is the SECOND drag: a suite that reordered once and
 * checked the result passed throughout.
 */
test.describe("reordering an array by dragging", () => {
  /** dnd-kit's mouse sensor needs movement, in steps a collision check can see. */
  async function dragOnto(page: Page, from: Locator, to: Locator) {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    if (!a || !b) throw new Error("a drag handle had no box");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 8; step++) {
      await page.mouse.move(
        a.x + a.width / 2,
        a.y + a.height / 2 + (b.y - a.y) * (step / 8),
        { steps: 3 },
      );
    }
    await page.mouse.up();
  }

  const titles = (page: Page) =>
    page.evaluate(() => {
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
      ).__VAL_STORES__.system.sourceStore.peek("/content/handbook.val.ts");
      const rows =
        peek.status === "ready" ? (peek.data as { title: string }[]) : [];
      return rows.map((row) => row.title);
    });

  test("stays draggable after a drag", async ({ page }) => {
    await openStudio(page, "/val/~/content/handbook.val.ts");
    const studio = page.locator("#val-shadow-root");
    const grips = studio.locator("button:has(svg.lucide-grip-vertical)");
    await expect(grips.first()).toBeEnabled();
    const before = await titles(page);
    expect(before.length).toBeGreaterThan(2);

    await dragOnto(page, grips.nth(0), grips.nth(1));
    await expect
      .poll(() => titles(page))
      .toEqual([before[1], before[0], ...before.slice(2)]);

    // The handles are still handles. This is the assertion the bug failed: the
    // reorder above worked, and then the control was gone.
    await expect(grips.first()).toBeEnabled();
    await expect(grips.nth(1)).toBeEnabled();

    // And it really is usable, not merely un-disabled: a second drag moves it
    // back, which nothing but a working handle can do.
    await dragOnto(page, grips.nth(0), grips.nth(1));
    await expect.poll(() => titles(page)).toEqual(before);

    await discardAll(page);
    await expect.poll(() => chainLength(page)).toBe(0);
  });
});

/**
 * Editing a field INSIDE a `.jsonValues()` entry.
 *
 * The gap this closes: every `.jsonValues()` test read entry content, and none
 * edited it. So nothing noticed that `applyEntries` applied patches against the
 * RAW module source — which still holds the entry markers, entry content being
 * stitched in only on read. A `replace` at `["/support/getting-started", "title"]`
 * was therefore applied to `{_type: "json"}`, failed with "Cannot replace object
 * element which does not exist", and the edit never appeared.
 *
 * It was survivable while a failed apply was merely invisible — the patch still
 * reached the server, which applies it to the backing `*.val.json` correctly, so
 * the edit came back after a reload. It stopped being survivable the moment an
 * unapplicable patch started being deleted: then the edit was destroyed, with a
 * console message insisting the content did not have the path it plainly had.
 *
 * Driven through the UI on the real route a user reported, because the store-level
 * test cannot see the console error or the field.
 */
test.describe("a field inside a jsonValues entry", () => {
  const ROUTE =
    "/val/~/app/support/[slug]/page.val.ts?p=%22/support/getting-started%22";
  const TITLE =
    '/app/support/[slug]/page.val.ts?p="/support/getting-started"."title"';

  test("applies the edit, and does not discard the patch", async ({ page }) => {
    // Anything claiming a patch could not be applied is a failure here: the
    // module is fully loaded and the path exists.
    const refused: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/cannot be applied|Cannot replace|discarding a patch/.test(text)) {
        refused.push(text.slice(0, 200));
      }
    });

    await openStudio(page, ROUTE);
    const studio = page.locator("#val-shadow-root");
    const field = studio
      .locator("input:not([type=file]):not([disabled])")
      .first();
    await expect(field).toBeVisible();

    const typed = `Edited by e2e ${Date.now()}`;
    await field.fill(typed);
    await field.blur();

    // The store has it, which is what a failed apply would deny.
    await expect
      .poll(
        () =>
          page.evaluate((path) => {
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
            ).__VAL_STORES__.system.sourceStore.peek(path);
            return peek.status === "ready" ? peek.data : peek.status;
          }, TITLE),
        { timeout: 20_000 },
      )
      .toBe(typed);

    // And the patch is still there — an unapplicable one is deleted, so a
    // surviving chain is the other half of the claim.
    await expect.poll(() => chainLength(page)).toBeGreaterThan(0);
    expect(
      refused,
      "the apply refused a patch it should have accepted",
    ).toEqual([]);

    await discardAll(page);
    await expect.poll(() => chainLength(page)).toBe(0);
  });
});

/**
 * Getting back to what you were just editing.
 *
 * The empty search used to answer with every page in the project, which answers
 * "take me somewhere" — but opening search without typing is usually "take me
 * back". The patch sets already know: they are newest first and grouped by the
 * thing that changed, which is exactly this list.
 *
 * This is also the first thing that makes the activity rows mean anything. They
 * carried an id that was a React key rather than a path, and no handler was
 * passed for them at all, so clicking one did nothing.
 */
test.describe("recently changed", () => {
  test("is offered by search, and goes back to it", async ({
    page,
    request,
  }) => {
    await clearPatchChain(request);
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");

    const title = studio.locator("input").first();
    await expect(title).toHaveValue("Blog 1");
    await title.fill("Blog 1 revisited");

    /**
     * Wait for the patch to reach the server before leaving.
     *
     * Not politeness: the next step is a full reload, and the patch sets this
     * list is built from are rebuilt from the server's chain. Typing is
     * debounced, so navigating immediately threw the edit away and the list was
     * correctly empty — a test failing on a precondition it never established.
     */
    await expect
      .poll(
        async () => {
          const listed = await request.get("/api/val/patches");
          const body = (await listed.json()) as { patches: unknown[] };
          return body.patches.length;
        },
        { message: "the edit never reached the server" },
      )
      .toBeGreaterThan(0);

    // Somewhere else entirely, so going back has to actually navigate.
    await openStudio(page, "/val/~/content/authors.val.ts");

    await studio.getByRole("button", { name: "Search" }).first().click();
    await expect(
      studio.getByText("Recently changed"),
      "the empty search did not offer what had just changed",
    ).toBeVisible({ timeout: 30000 });

    // The row reads as a trail from the file to the field inside it.
    const row = studio.getByRole("button", { name: /page › .*title/ }).first();
    await expect(row).toBeVisible();
    await row.click();

    /**
     * Back on the blog post, with the edit still there.
     *
     * The page in `p` and the field in `field`, not the field in `p`: a field is
     * opened IN CONTEXT — the whole page, scrolled to it — so that a title you
     * clicked does not arrive as the only thing on screen. `field` is what
     * carries the exact path (see `ValRouter`).
     */
    await expect
      .poll(() => new URL(page.url()).searchParams.get("field"), {
        message: "going back to a recent change did not open the field",
      })
      .toContain("title");
    expect(new URL(page.url()).searchParams.get("p")).toBe('"/blogs/blog1"');
    await expect(studio.locator("input").first()).toHaveValue(
      "Blog 1 revisited",
    );
    await clearPatchChain(request);
  });
});

/**
 * Creating a page, which needs to say which route.
 *
 * A project can have several routers that accept one — `/blogs/[blog]`,
 * `/generic/[[...path]]`, `/support/[slug]` — so a New page button that does not
 * ask cannot know where the page goes. It also used to not ask because it did
 * nothing at all: `onNewPage` was never passed, exactly like the media upload.
 *
 * The form itself is the classic nav menu's, reused rather than rebuilt: it
 * already knows that a literal segment is a chip, a `[param]` is an input, and
 * a `[[...path]]` may be left blank to mean the base route.
 */
test.describe("creating a page", () => {
  test("asks which route, and opens the page it made", async ({ page }) => {
    await openStudio(page);
    const studio = await openNavPanel(page, "Pages");

    await studio.getByRole("button", { name: "New page" }).first().click();
    // More than one router accepts a page in this project, so the form has to
    // offer the choice rather than pick for you.
    const route = studio.getByLabel("Route");
    await expect(
      route,
      "the form did not offer the routes that accept a page",
    ).toBeVisible();

    const slug = `e2e-${Date.now()}`;
    // The dynamic segment of whichever route is selected first.
    const input = studio.locator("form input").first();
    await input.fill(slug);
    await studio.getByRole("button", { name: "Create" }).click();

    // It opens what it made: creating a page and being left on the list is a
    // step nobody wants.
    await expect
      .poll(() => decodeURIComponent(page.url()), { timeout: 20000 })
      .toContain(slug);
    await expect.poll(() => chainLength(page)).toBeGreaterThan(0);

    await discardAll(page);
  });

  test("says when the path is already taken", async ({ page }) => {
    await openStudio(page);
    const studio = await openNavPanel(page, "Pages");
    await studio.getByRole("button", { name: "New page" }).first().click();

    // A path that exists in the example app's blog router.
    const input = studio.locator("form input").first();
    await input.fill("blog1");
    await expect(
      studio.getByText(/already exists/i),
      "the form let an existing path through",
    ).toBeVisible();
    await expect(studio.getByRole("button", { name: "Create" })).toBeDisabled();
  });
});

/**
 * `hidden()` and `readonly()`.
 *
 * Nothing on the server enforces either: a patch for a readonly field is
 * accepted, and a hidden field's value is served like any other. The Studio is
 * the whole of the enforcement, which makes "it looks readonly" and "it IS
 * readonly" different claims — and only the second is worth anything.
 *
 * Readonly was the first kind: the field was dimmed and mouse-proof
 * (`pointer-events-none`), and still perfectly typeable once Tab had put the
 * cursor in it, patch and all. So the assertion is a keystroke and the chain
 * length, not a class name.
 *
 * Fixture: `examples/next/content/access.val.ts`.
 */
test.describe("hidden and readonly", () => {
  const MODULE = "/content/access.val.ts";

  test("a readonly field cannot be typed into, by mouse or keyboard", async ({
    page,
    request,
  }) => {
    await clearPatchChain(request);
    await openStudio(page, `/val/~${MODULE}`);
    const studio = page.locator("#val-shadow-root");

    const locked = studio.locator('input[value="Do not edit"]');
    await expect(locked).toBeVisible({ timeout: 30000 });

    // Focus it the way `pointer-events-none` cannot stop, then type.
    await locked.evaluate((el) => (el as HTMLInputElement).focus());
    await page.keyboard.type("nope");

    await expect(locked, "typing into a readonly field changed it").toHaveValue(
      "Do not edit",
    );
    await expect
      .poll(() => chainLength(page), {
        message: "a readonly field wrote a patch",
      })
      .toBe(0);
  });

  test("a hidden field is not rendered at all", async ({ page }) => {
    await openStudio(page, `/val/~${MODULE}`);
    const studio = page.locator("#val-shadow-root");
    // The editable field proves the module rendered.
    await expect(studio.locator('input[value="Type here"]')).toBeVisible({
      timeout: 30000,
    });

    // Not as a disabled row, not as an empty labelled box: absent.
    await expect(studio.getByText("secret", { exact: true })).toHaveCount(0);
    await expect(
      studio.locator('input[value="Not on screen"]'),
      "a hidden field put its value in the DOM",
    ).toHaveCount(0);
    await expect(
      studio.locator('input[value="Also not on screen"]'),
      "a hidden field nested in an object was still rendered",
    ).toHaveCount(0);
  });

  test("an editable field beside them still works", async ({
    page,
    request,
  }) => {
    await clearPatchChain(request);
    await openStudio(page, `/val/~${MODULE}`);
    const studio = page.locator("#val-shadow-root");
    const editable = studio.locator('input[value="Type here"]');
    await expect(editable).toBeVisible({ timeout: 30000 });
    await editable.fill("Typed");
    await expect
      .poll(() => chainLength(page), {
        message: "the restricted fields took the editable one down with them",
      })
      .toBeGreaterThan(0);
    await clearPatchChain(request);
  });
});
