import {
  expect,
  type APIRequestContext,
  type FrameLocator,
  type Page,
} from "@playwright/test";
import {
  closeNavPanel,
  expandRow,
  openSiteMap,
  openStudio,
  test,
} from "./studio";

/**
 * Editing on the page (a beta): with it turned on, a click on a text in the
 * preview puts the caret in that text, on the page, and what is typed is
 * written as the field in the Studio's column would write it.
 *
 * Only a real browser says this works. The caret, Enter, Backspace and a
 * click's place in the text are the browser's own editing, which jsdom has
 * none of; and the edit crosses the frame twice -- the pick out, the request
 * to edit in, every keystroke out, and the page's re-render of its own
 * element underneath a copy that must not notice. See
 * `architecture/inline-editing.md`.
 *
 * A suite as a function, for the reason the canvas suite is one
 * (`canvasSuite.ts`): the page's half is `ValCanvasBridge`, a copy per
 * framework, so each app gets the whole of it. `inline-editing.spec.ts` runs
 * it against TanStack and `inline-editing.next.spec.ts` against Next, on the
 * blog page both have.
 */

/** `inlineEditingPreference.ts`: what the account panel's setting writes. */
export const INLINE_EDITING_PREFERENCE = "val:beta:inline-editing";

/**
 * What the SERVER holds for a field: the value of the last patch that
 * replaced what is at `path`, as JSON, or `null` when none did. Asked of
 * the server because that is where an edit has to end up, however it was
 * made (`e2e/README.md`). By the path alone, whichever module it is in: the
 * same page is a different file in each app.
 */
export async function written(
  request: APIRequestContext,
  path: string[],
): Promise<string | null> {
  const res = await request.get("/api/val/patches");
  expect(res.ok(), `the server refused the request: ${res.status()}`).toBe(
    true,
  );
  const body = (await res.json()) as {
    patches: { patch?: { op: string; path: string[]; value?: unknown }[] }[];
  };
  const values = body.patches
    .flatMap((patch) => patch.patch ?? [])
    .filter(
      (op) => op.op === "replace" && op.path.join("\n") === path.join("\n"),
    )
    .map((op) => JSON.stringify(op.value));
  return values.at(-1) ?? null;
}

/** The page in the preview, once Select is on and there is something to pick. */
export async function selectOnPreview(page: Page): Promise<FrameLocator> {
  // The page reporting its fields is when there is something to pick.
  await expect(page.getByRole("tab", { name: /On this page \d/ })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Select on the page" }).click();
  await expect(
    page.getByRole("button", { name: "Stop selecting on the page" }),
  ).toHaveAttribute("aria-pressed", "true");
  return page.frameLocator('iframe[title^="Preview of"]');
}

/** The copy being typed in, on the page. */
export const inlineEditor = (preview: FrameLocator) =>
  preview.locator("[data-val-inline-editor]");

/** Turn the beta on for every page this test opens. */
export async function turnOnInlineEditing(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, "1");
  }, INLINE_EDITING_PREFERENCE);
}

const BLOG = "/blogs/blog1";

/** The blog page both apps have, in the preview, with Select on. */
async function openBlog(page: Page): Promise<FrameLocator> {
  await openStudio(page);
  const studio = await openSiteMap(page);
  await expandRow(studio, "blogs");
  await expandRow(studio, "blog1");
  await closeNavPanel(studio, "Pages");
  await studio.getByRole("button", { name: "Canvas" }).click();
  const preview = await selectOnPreview(page);
  // The first request for the route compiles it: see `canvasSuite.ts`.
  await expect(preview.locator("h1")).toHaveText("Blog 1", {
    timeout: 60_000,
  });
  return preview;
}

export function defineInlineEditingSuite(): void {
  // A laptop where the column and the preview are side by side.
  test.use({ viewport: { width: 1512, height: 900 } });

  test.describe("editing on the page", () => {
    test("is off until someone turns it on: a pick opens the field in the column", async ({
      page,
    }) => {
      const preview = await openBlog(page);
      const headline = preview.locator("h1");
      await headline.click();
      // Opened in the column, which the page shows by outlining the field
      // the Studio is on -- seen with the pointer off it, since hovering
      // outlines anything.
      await page.mouse.move(0, 0);
      await expect(headline).toHaveCSS("outline-width", "2px");
      await expect(inlineEditor(preview)).toHaveCount(0);
      await expect(headline).not.toHaveAttribute("contenteditable");
    });

    test.describe("turned on", () => {
      test.beforeEach(async ({ page }) => {
        await turnOnInlineEditing(page);
      });

      test("a headline is typed in where it is, and written as its field", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page);
        await preview.locator("h1").click();
        const copy = inlineEditor(preview);
        await expect(
          copy,
          "the caret did not go into the headline",
        ).toBeFocused();
        await expect(copy).toHaveText("Blog 1");

        await page.keyboard.press("End");
        await page.keyboard.type(", on the page");
        await expect(copy).toHaveText("Blog 1, on the page");
        // Written as a string field writes: the whole value, on a pause.
        await expect
          .poll(() => written(request, [BLOG, "title"]))
          .toBe(JSON.stringify("Blog 1, on the page"));
        // The page re-rendered its own headline underneath, and the caret
        // is still where it was: more typing lands at the end, not the
        // start.
        await page.keyboard.type("!");
        await expect(copy).toHaveText("Blog 1, on the page!");

        // Enter ends a single line, and the page's own element comes back
        // showing what was typed.
        await page.keyboard.press("Enter");
        await expect(inlineEditor(preview)).toHaveCount(0);
        await expect(preview.locator("h1")).toHaveCount(1);
        await expect(preview.locator("h1")).toHaveText("Blog 1, on the page!");
        await expect
          .poll(() => written(request, [BLOG, "title"]))
          .toBe(JSON.stringify("Blog 1, on the page!"));
        // Select is still on: Enter ended the edit, not the mode.
        await expect(
          page.getByRole("button", { name: "Stop selecting on the page" }),
        ).toHaveAttribute("aria-pressed", "true");
      });

      test("Enter and Backspace split and join a richtext's paragraphs", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page);
        await preview.getByText("Blog 1 content").click();
        const copy = inlineEditor(preview);
        await expect(
          copy,
          "the caret did not go into the richtext",
        ).toBeFocused();

        const content = [BLOG, "content"];
        await page.keyboard.press("End");
        await page.keyboard.type(", typed here");
        await expect
          .poll(() => written(request, content))
          .toBe(
            JSON.stringify([
              { tag: "p", children: ["Blog 1 content, typed here"] },
            ]),
          );

        await page.keyboard.press("Enter");
        await page.keyboard.type("And a second paragraph");
        await expect
          .poll(() => written(request, content))
          .toBe(
            JSON.stringify([
              { tag: "p", children: ["Blog 1 content, typed here"] },
              { tag: "p", children: ["And a second paragraph"] },
            ]),
          );
        await expect(copy.locator("p")).toHaveCount(2);

        await page.keyboard.press("Home");
        await page.keyboard.press("Backspace");
        await expect
          .poll(() => written(request, content))
          .toBe(
            JSON.stringify([
              {
                tag: "p",
                children: ["Blog 1 content, typed hereAnd a second paragraph"],
              },
            ]),
          );

        // Esc ends the edit and leaves Select on.
        await page.keyboard.press("Escape");
        await expect(inlineEditor(preview)).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Stop selecting on the page" }),
        ).toHaveAttribute("aria-pressed", "true");
      });

      test("of a link's two fields, its words are the one typed in", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page);
        await preview.getByRole("link", { name: "See more" }).click();
        await expect(inlineEditor(preview)).toBeFocused();
        await page.keyboard.press("End");
        await page.keyboard.type(" now");
        await expect
          .poll(() => written(request, [BLOG, "link", "label"]))
          .toBe(JSON.stringify("See more now"));
        // Where it leads was not touched, and the link was not followed.
        expect(await written(request, [BLOG, "link", "href"])).toBeNull();
        await expect(preview.locator("h1")).toHaveText("Blog 1");
      });

      test("a text shown inside a sentence still opens in the column", async ({
        page,
      }) => {
        const preview = await openBlog(page);
        // "Author: <name>": the name is a field, and the element holds more
        // than it. The page says it cannot edit that in place, and the
        // Studio does what a pick does: opens the field, which its address
        // names.
        await preview.getByText(/^Author: /).click();
        await expect(page).toHaveURL(/[?&]field=[^&]*authors[^&]*name/);
        await expect(inlineEditor(preview)).toHaveCount(0);
      });
    });
  });
}
