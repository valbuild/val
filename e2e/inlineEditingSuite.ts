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
 * Editing on the page: in Select's "Select & edit" mode, a click on a text in the
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

/** What Content's Select does with a pick: `CanvasSelectMode` in the Studio. */
export type SelectMode = "select" | "edit";

/**
 * The page in the preview, once Select is on in `mode` and there is
 * something to pick.
 *
 * "Select & edit" is chosen as a person chooses it, from the menu beside
 * Select -- which also turns it on.
 */
export async function selectOnPreview(
  page: Page,
  mode: SelectMode = "select",
): Promise<FrameLocator> {
  // The page reporting its fields is when there is something to pick.
  await expect(page.getByRole("tab", { name: /On this page \d/ })).toBeVisible({
    timeout: 60_000,
  });
  if (mode === "edit") {
    await page
      .getByRole("button", { name: "Choose what selecting on the page does" })
      .click();
    await page.getByRole("menuitemradio", { name: /Select & edit/ }).click();
    await expect(
      page.getByRole("button", {
        name: "Stop selecting and editing on the page",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  } else {
    await page.getByRole("button", { name: "Select on the page" }).click();
    await expect(
      page.getByRole("button", { name: "Stop selecting on the page" }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  return page.frameLocator('iframe[title^="Preview of"]');
}

/** The copy being typed in, on the page. */
export const inlineEditor = (preview: FrameLocator) =>
  preview.locator("[data-val-inline-editor]");

/**
 * A field's row in the Studio's "On this page" column, by the end of its
 * path (`."title"`, or `?p="footer"` for a field of the module itself): the
 * start is the module's file, which is a different one in each app.
 */
export const columnRow = (page: Page, pathEnd: string) =>
  page.locator(`[data-canvas-field$='${pathEnd}']`);

/** The Studio's formatting controls for a richtext being typed in on the page. */
export const inlineToolbar = (page: Page) =>
  page.getByRole("toolbar", { name: "Format the text on the page" });

/**
 * Select the first `count` characters of the line the caret is on, as a
 * person does it: Home, then Shift and the arrow.
 */
export async function selectFromLineStart(
  page: Page,
  count: number,
): Promise<void> {
  await page.keyboard.press("Home");
  for (let index = 0; index < count; index++) {
    await page.keyboard.press("Shift+ArrowRight");
  }
}

const BLOG = "/blogs/blog1";

/** The blog page both apps have, in the preview, with Select on. */
async function openBlog(
  page: Page,
  mode: SelectMode = "select",
): Promise<FrameLocator> {
  await openStudio(page);
  const studio = await openSiteMap(page);
  await expandRow(studio, "blogs");
  await expandRow(studio, "blog1");
  await closeNavPanel(studio, "Pages");
  await studio.getByRole("button", { name: "Canvas" }).click();
  const preview = await selectOnPreview(page, mode);
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
    test("Select, the mode it starts in, opens the field in the column", async ({
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

    test.describe("in Select & edit", () => {
      test("a headline is typed in where it is, and written as its field", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page, "edit");
        await preview.locator("h1").click();
        const copy = inlineEditor(preview);
        await expect(
          copy,
          "the caret did not go into the headline",
        ).toBeFocused();
        await expect(copy).toHaveText("Blog 1");

        // The column shows the field too: the caret is on the page, and
        // the row for what it is in is in front of you beside it.
        const row = columnRow(page, '."title"');
        await expect(row).toBeInViewport();

        await page.keyboard.press("End");
        await page.keyboard.type(", on the page");
        await expect(copy).toHaveText("Blog 1, on the page");
        // ...and follows what is typed, without having taken the caret.
        await expect(row.locator("input")).toHaveValue("Blog 1, on the page");
        await expect(copy).toBeFocused();
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
          page.getByRole("button", {
            name: "Stop selecting and editing on the page",
          }),
        ).toHaveAttribute("aria-pressed", "true");
      });

      test("what is typed straight after the click goes into the text, none of it lost", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page, "edit");
        // No waiting for the caret between the click and the keys: a
        // person does not wait either. The edit used to start a round trip
        // across the frame after the click, and the keys pressed in it --
        // the End included -- went to the page and were dropped.
        await preview.locator("h1").click();
        await page.keyboard.press("End");
        await page.keyboard.type(" quickly typed text");
        const copy = inlineEditor(preview);
        await expect(copy).toHaveText("Blog 1 quickly typed text");
        await expect(copy).toBeFocused();
        await expect
          .poll(() => written(request, [BLOG, "title"]))
          .toBe(JSON.stringify("Blog 1 quickly typed text"));
      });

      test.describe("when the page's copy of a text is out of date", () => {
        /*
         * The page usually starts an edit in the click, from what the Studio
         * told it the texts hold (`textFields`). When that is out of date --
         * an edit a moment ago, still on its way -- it asks the Studio as
         * before and holds the keys pressed until the answer. That race is
         * not something a test can win on purpose, so the page is made to
         * have an out-of-date copy: in the preview frame, before the bridge
         * hears it, every value the Studio says is changed.
         */
        test.beforeEach(async ({ page }) => {
          await page.addInitScript(() => {
            if (window.parent === window) return;
            const MARK = "__valStale";
            window.addEventListener(
              "message",
              (event: MessageEvent) => {
                const data: unknown = event.data;
                if (
                  typeof data !== "object" ||
                  data === null ||
                  Reflect.get(data, "type") !== "textFields" ||
                  Reflect.get(data, MARK) === true
                ) {
                  return;
                }
                event.stopImmediatePropagation();
                const editable: unknown = Reflect.get(data, "editable");
                const stale = {
                  ...data,
                  [MARK]: true,
                  editable: Array.isArray(editable)
                    ? editable.map((candidate: unknown) =>
                        typeof candidate === "object" && candidate !== null
                          ? {
                              ...candidate,
                              value:
                                Reflect.get(candidate, "kind") === "string"
                                  ? "out of date"
                                  : [],
                            }
                          : candidate,
                      )
                    : editable,
                };
                window.dispatchEvent(
                  new MessageEvent("message", {
                    data: stale,
                    origin: event.origin,
                    source: event.source,
                  }),
                );
              },
              { capture: true },
            );
          });
        });

        test("the keys pressed while the Studio is asked go into the text once it starts", async ({
          page,
          request,
        }) => {
          const preview = await openBlog(page, "edit");
          await preview.locator("h1").click();
          await page.keyboard.press("End");
          await page.keyboard.type(" held and replayed");
          const copy = inlineEditor(preview);
          await expect(copy).toHaveText("Blog 1 held and replayed");
          await expect(copy).toBeFocused();
          await expect
            .poll(() => written(request, [BLOG, "title"]))
            .toBe(JSON.stringify("Blog 1 held and replayed"));
        });

        test("...and are dropped, typed nowhere, when the field opens in the column instead", async ({
          page,
          request,
        }) => {
          const preview = await openBlog(page, "edit");
          // A name inside a sentence: a string, so the page holds the keys
          // and asks, and not one it can type in where it is.
          await preview.getByText(/^Author: /).click();
          await page.keyboard.type("dropped");
          await expect(page).toHaveURL(/[?&]field=[^&]*authors[^&]*name/);
          await expect(inlineEditor(preview)).toHaveCount(0);
          // Opening the field may take the canvas to the authors' page:
          // the keys are on neither, and nothing was written with them.
          await expect(preview.getByText(/dropped/)).toHaveCount(0);
          const patches = await request.get("/api/val/patches");
          expect(await patches.text()).not.toContain("dropped");
        });
      });

      test("a text left empty can be clicked again, and typed back in", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page, "edit");
        const headline = preview.locator("h1");
        await headline.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.press("Backspace");
        await page.keyboard.press("Enter");
        await expect(inlineEditor(preview)).toHaveCount(0);
        await expect
          .poll(() => written(request, [BLOG, "title"]))
          .toBe(JSON.stringify(""));
        await expect(headline).toHaveText("");

        // Empty, the heading has no height of its own; while Select is on it
        // is given a line, so there is something to point at...
        const height = async () => (await headline.boundingBox())?.height ?? 0;
        await expect.poll(height).toBeGreaterThan(0);
        // ...and only then: with Select off the page is laid out as built.
        await page
          .getByRole("button", {
            name: "Stop selecting and editing on the page",
          })
          .click();
        await expect.poll(height).toBe(0);
        await page
          .getByRole("button", { name: "Select and edit on the page" })
          .click();
        await expect.poll(height).toBeGreaterThan(0);

        // A plain click, not a forced one: it puts the caret in it.
        await headline.click();
        const copy = inlineEditor(preview);
        await expect(
          copy,
          "the caret did not go into the emptied headline",
        ).toBeFocused();
        await page.keyboard.type("Blog 1 again");
        await expect(copy).toHaveText("Blog 1 again");
        await expect
          .poll(() => written(request, [BLOG, "title"]))
          .toBe(JSON.stringify("Blog 1 again"));
        await page.keyboard.press("Enter");
        // The copy stays until the page shows what was typed: one headline
        // again before it is read.
        await expect(inlineEditor(preview)).toHaveCount(0);
        await expect(preview.locator("h1")).toHaveText("Blog 1 again");
      });

      test("Enter and Backspace split and join a richtext's paragraphs", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page, "edit");
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
          page.getByRole("button", {
            name: "Stop selecting and editing on the page",
          }),
        ).toHaveAttribute("aria-pressed", "true");
      });

      test("the floating controls are beside the text, inside the preview, and make the selection bold", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page, "edit");
        await preview.getByText("Blog 1 content").click();
        const copy = inlineEditor(preview);
        await expect(copy).toBeFocused();
        const toolbar = inlineToolbar(page);
        await expect(toolbar).toBeVisible();

        // Beside the text and never over it -- above it where there is
        // room, below it where the text is at the top of the preview, as it
        // is in one of the two apps -- and not cut off by the preview's edge
        // or drawn over the Studio around it.
        const bar = await toolbar.boundingBox();
        const text = await copy.boundingBox();
        const frame = await page
          .locator('iframe[title^="Preview of"]')
          .boundingBox();
        if (bar === null || text === null || frame === null) {
          throw new Error("the controls, the text or the preview has no box");
        }
        const above = bar.y + bar.height <= text.y;
        const below = bar.y >= text.y + text.height;
        expect(above || below, "the controls are over the text").toBe(true);
        expect(bar.y).toBeGreaterThanOrEqual(frame.y);
        expect(bar.x).toBeGreaterThanOrEqual(frame.x);
        expect(bar.x + bar.width).toBeLessThanOrEqual(frame.x + frame.width);

        await selectFromLineStart(page, 4);
        await toolbar.getByTitle(/Bold/).click();
        const content = [BLOG, "content"];
        await expect
          .poll(() => written(request, content))
          .toBe(
            JSON.stringify([
              {
                tag: "p",
                children: [
                  { tag: "span", styles: ["bold"], children: ["Blog"] },
                  " 1 content",
                ],
              },
            ]),
          );
        // Shown on the page, in the text being typed in...
        await expect(copy.locator("span")).toHaveText("Blog");
        // ...where the caret still is: the press did not take it.
        await expect(copy).toBeFocused();
        await page.keyboard.press("End");
        await page.keyboard.type(", and on");
        await expect
          .poll(() => written(request, content))
          .toBe(
            JSON.stringify([
              {
                tag: "p",
                children: [
                  { tag: "span", styles: ["bold"], children: ["Blog"] },
                  " 1 content, and on",
                ],
              },
            ]),
          );
        // Bold again takes it off.
        await selectFromLineStart(page, 4);
        await toolbar.getByTitle(/Bold/).click();
        await expect
          .poll(() => written(request, content))
          .toBe(
            JSON.stringify([
              { tag: "p", children: ["Blog 1 content, and on"] },
            ]),
          );
      });

      test("undo and redo go back over typing, Enter and a control, and are written", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page, "edit");
        await preview.getByText("Blog 1 content").click();
        const copy = inlineEditor(preview);
        await expect(copy).toBeFocused();
        const toolbar = inlineToolbar(page);
        const content = [BLOG, "content"];
        const typedOnce = JSON.stringify([
          { tag: "p", children: ["Blog 1 content, typed"] },
        ]);
        const bold = JSON.stringify([
          {
            tag: "p",
            children: [
              { tag: "span", styles: ["bold"], children: ["Blog"] },
              " 1 content, typed",
            ],
          },
        ]);

        // A burst of typing, then a paragraph made with Enter.
        await page.keyboard.press("End");
        await page.keyboard.type(", typed");
        await expect.poll(() => written(request, content)).toBe(typedOnce);
        await page.keyboard.press("Enter");
        await page.keyboard.type("More");
        await expect(copy.locator("p")).toHaveCount(2);
        await page.keyboard.press("ControlOrMeta+z");
        await expect(copy.locator("p")).toHaveCount(2);
        await expect(copy.locator("p").nth(1)).toHaveText("");
        await page.keyboard.press("ControlOrMeta+z");
        await expect(copy.locator("p")).toHaveCount(1);
        await expect(copy).toHaveText("Blog 1 content, typed");
        await expect.poll(() => written(request, content)).toBe(typedOnce);

        // A control's change, and then back over it AND what was typed
        // before it: the browser's own history ended at the control.
        await selectFromLineStart(page, 4);
        await toolbar.getByTitle(/Bold/).click();
        await expect.poll(() => written(request, content)).toBe(bold);
        await expect(copy.locator("span")).toHaveText("Blog");
        await page.keyboard.press("ControlOrMeta+z");
        await expect(copy.locator("span")).toHaveCount(0);
        await expect.poll(() => written(request, content)).toBe(typedOnce);
        await page.keyboard.press("ControlOrMeta+z");
        await expect(copy).toHaveText("Blog 1 content");
        await expect
          .poll(() => written(request, content))
          .toBe(JSON.stringify([{ tag: "p", children: ["Blog 1 content"] }]));
        await expect(copy).toBeFocused();

        // And forward again, by either of redo's keys.
        await page.keyboard.press("ControlOrMeta+Shift+z");
        await expect(copy).toHaveText("Blog 1 content, typed");
        await expect.poll(() => written(request, content)).toBe(typedOnce);
        await page.keyboard.press("Control+y");
        await expect(copy.locator("span")).toHaveText("Blog");
        await expect.poll(() => written(request, content)).toBe(bold);
      });

      test("a control pressed with only a caret marks what is typed next", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page, "edit");
        await preview.getByText("Blog 1 content").click();
        const copy = inlineEditor(preview);
        await expect(copy).toBeFocused();
        const bold = inlineToolbar(page).getByTitle(/Bold/);
        const content = [BLOG, "content"];

        await page.keyboard.press("End");
        await expect(bold).toHaveAttribute("aria-pressed", "false");
        await bold.click();
        // Shown on, though nothing on the page is bold yet...
        await expect(bold).toHaveAttribute("aria-pressed", "true");
        await expect(copy).toBeFocused();
        // ...and what is typed next is.
        await page.keyboard.type(" strong");
        await expect
          .poll(() => written(request, content))
          .toBe(
            JSON.stringify([
              {
                tag: "p",
                children: [
                  "Blog 1 content",
                  { tag: "span", styles: ["bold"], children: [" strong"] },
                ],
              },
            ]),
          );
        await expect(copy.locator("span")).toHaveText(" strong");
        await expect(bold).toHaveAttribute("aria-pressed", "true");

        // Pressed again inside the bold words: what comes next is not.
        await bold.click();
        await expect(bold).toHaveAttribute("aria-pressed", "false");
        await page.keyboard.type(" plain");
        await expect
          .poll(() => written(request, content))
          .toBe(
            JSON.stringify([
              {
                tag: "p",
                children: [
                  "Blog 1 content",
                  { tag: "span", styles: ["bold"], children: [" strong"] },
                  " plain",
                ],
              },
            ]),
          );

        // Moving the caret forgets a mark that was never typed with.
        await bold.click();
        await expect(bold).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("Home");
        await expect(bold).toHaveAttribute("aria-pressed", "false");
        await page.keyboard.type("A ");
        await expect
          .poll(() => written(request, content))
          .toBe(
            JSON.stringify([
              {
                tag: "p",
                children: [
                  "A Blog 1 content",
                  { tag: "span", styles: ["bold"], children: [" strong"] },
                  " plain",
                ],
              },
            ]),
          );
      });

      test("a link is picked from the site's pages, and Esc in the picker closes only the picker", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page, "edit");
        await preview.getByText("Blog 1 content").click();
        const copy = inlineEditor(preview);
        await expect(copy).toBeFocused();
        const toolbar = inlineToolbar(page);
        await selectFromLineStart(page, 4);

        await toolbar.getByTitle(/Link/).click();
        const filter = page.getByPlaceholder("Filter...");
        await expect(filter).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(filter).toHaveCount(0);
        // The edit goes on, with the caret back in the text.
        await expect(copy).toBeFocused();

        await toolbar.getByTitle(/Link/).click();
        await expect(filter).toBeFocused();
        await page.keyboard.type("blog-2");
        await page.keyboard.press("Enter");
        await expect
          .poll(() => written(request, [BLOG, "content"]))
          .toMatch(
            /^\[\{"tag":"p","children":\[\{"tag":"a","href":"\/blogs\/blog-2[^"]*","children":\["Blog"\]\}," 1 content"\]\}\]$/,
          );
        await expect(copy.locator("a")).toHaveText("Blog");
        await expect(copy).toBeFocused();
      });

      test("a press elsewhere in the Studio ends the edit", async ({
        page,
      }) => {
        const preview = await openBlog(page, "edit");
        await preview.getByText("Blog 1 content").click();
        await expect(inlineEditor(preview)).toBeFocused();
        await expect(inlineToolbar(page)).toBeVisible();
        await page.getByPlaceholder("Filter fields…").click();
        await expect(inlineEditor(preview)).toHaveCount(0);
        await expect(inlineToolbar(page)).toHaveCount(0);
      });

      test("zooming and changing the width keep the caret in the text, and typing goes on being written", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page, "edit");
        await preview.locator("h1").click();
        const copy = inlineEditor(preview);
        await expect(copy).toBeFocused();
        await page.keyboard.press("End");
        await page.keyboard.type("A");

        // The preview's own controls change how the page is looked at, and
        // leave what is being typed in it alone.
        const controls = page.getByRole("toolbar", { name: "Preview" });
        const frame = page.locator('iframe[title^="Preview of"]');
        const before = await frame.boundingBox();
        await controls.getByRole("button", { name: "Zoom in" }).click();
        await expect
          .poll(async () => (await frame.boundingBox())?.width)
          .toBeGreaterThan(before?.width ?? 0);
        await expect(copy).toBeFocused();
        await page.keyboard.type("B");
        await expect(copy).toHaveText("Blog 1AB");

        await controls.getByRole("button", { name: "mobile width" }).click();
        await expect(
          controls.getByRole("button", { name: "mobile width" }),
        ).toHaveAttribute("aria-pressed", "true");
        await expect(copy).toBeFocused();
        await page.keyboard.type("C");

        await controls.getByRole("button", { name: "Fit page width" }).click();
        await expect(copy).toBeFocused();
        await page.keyboard.type("D");
        await expect
          .poll(() => written(request, [BLOG, "title"]))
          .toBe(JSON.stringify("Blog 1ABCD"));
      });

      test("the floating controls follow a zoom", async ({ page }) => {
        const preview = await openBlog(page, "edit");
        await preview.getByText("Blog 1 content").click();
        const copy = inlineEditor(preview);
        await expect(copy).toBeFocused();
        const toolbar = inlineToolbar(page);
        await expect(toolbar).toBeVisible();
        /*
         * How far the bar is from the text, on the side it is on: placed
         * by the text (`placeInlineToolbar`), 8 away from it. Followed, it
         * stays that; left behind by a zoom, it does not. (Not its x: the
         * text starts at the preview's edge, where the bar is held.)
         */
        const gap = async () => {
          const bar = await toolbar.boundingBox();
          const text = await copy.boundingBox();
          if (bar === null || text === null) return "no box";
          const between =
            bar.y + bar.height <= text.y
              ? text.y - (bar.y + bar.height)
              : bar.y >= text.y + text.height
                ? bar.y - (text.y + text.height)
                : null;
          if (between === null) return "over the text";
          // A pixel either way for the scale's fractions.
          return Math.abs(between - 8) <= 1.5 ? "8 from the text" : between;
        };
        await expect.poll(gap).toBe("8 from the text");
        const frame = page.locator('iframe[title^="Preview of"]');
        const before = await frame.boundingBox();
        await page
          .getByRole("toolbar", { name: "Preview" })
          .getByRole("button", { name: "Zoom in" })
          .click();
        await expect
          .poll(async () => (await frame.boundingBox())?.width)
          .toBeGreaterThan(before?.width ?? 0);
        await expect.poll(gap).toBe("8 from the text");
        await expect(copy).toBeFocused();
      });

      test("the reload ends the edit, and what was typed is written", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page, "edit");
        await preview.locator("h1").click();
        const copy = inlineEditor(preview);
        await expect(copy).toBeFocused();
        await page.keyboard.press("End");
        // Straight to the reload: no pause for the typing to be written on.
        await page.keyboard.type(" again");
        await page
          .getByRole("toolbar", { name: "Preview" })
          .getByRole("button", { name: /Reload the page|Updating the page/ })
          .click();
        await expect
          .poll(() => written(request, [BLOG, "title"]))
          .toBe(JSON.stringify("Blog 1 again"));
        await expect(preview.locator("h1")).toHaveText("Blog 1 again");
        await expect(inlineEditor(preview)).toHaveCount(0);
      });

      test("of a link's two fields, its words are the one typed in", async ({
        page,
        request,
      }) => {
        const preview = await openBlog(page, "edit");
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
        const preview = await openBlog(page, "edit");
        // "Author: <name>": the name is a field, and the element holds more
        // than it. The page says it cannot edit that in place, and the
        // Studio does what a pick does: opens the field, which its address
        // names.
        await preview.getByText(/^Author: /).click();
        await expect(page).toHaveURL(/[?&]field=[^&]*authors[^&]*name/);
        await expect(inlineEditor(preview)).toHaveCount(0);
        // The click was to type, so the caret goes where it can be: the
        // field's row in the column.
        await expect(
          columnRow(page, '."name"').locator("input, textarea").first(),
        ).toBeFocused();
      });

      test("...and with Content switched off, Content comes back with the caret in it", async ({
        page,
      }) => {
        const preview = await openBlog(page, "edit");
        await page.getByRole("button", { name: "Close Content" }).click();
        await expect(
          page.getByRole("button", { name: "Open Content" }),
        ).toBeVisible();
        await preview.getByText(/^Author: /).click();
        await expect(
          page.getByRole("button", { name: "Close Content" }),
        ).toHaveAttribute("aria-pressed", "true");
        const name = columnRow(page, '."name"')
          .locator("input, textarea")
          .first();
        await expect(name).toBeVisible();
        await expect(name).toBeFocused();
      });
    });
  });
}
