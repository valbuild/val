import { expect } from "@playwright/test";
import { openStudio, test } from "./studio";
import {
  columnRow,
  defineInlineEditingSuite,
  inlineEditor,
  inlineToolbar,
  selectOnPreview,
  written,
} from "./inlineEditingSuite";

// Against TanStack, the suite's default app. `inline-editing.next.spec.ts`
// runs the same suite against Next.
defineInlineEditingSuite();

/**
 * And once on the showcase's front page, which only this app has: its lead
 * holds a bold word, and a mark is what editing on the page must not lose.
 */
test.describe("editing a richtext with marks on the page", () => {
  test.use({ viewport: { width: 1512, height: 900 } });

  test("what is typed in a bold word is bold, and a split and a join keep it", async ({
    page,
    request,
  }) => {
    await openStudio(page);
    await page.getByRole("button", { name: "Open the canvas" }).click();
    const preview = await selectOnPreview(page, "edit");
    await preview
      .locator("main > div span", { hasText: "Val" })
      .first()
      .click();
    const copy = inlineEditor(preview);
    await expect(copy, "the caret did not go into the richtext").toBeFocused();

    const lead = ["/", "hero", "lead"];
    // Into the bold word, wherever in it the click landed.
    await page.keyboard.type("X");
    await expect
      .poll(() => written(request, lead))
      .toMatch(/"styles":\["bold"\],"children":\["[Val]*X[Val]*"\]/);

    // Enter makes two paragraphs of the one; Backspace makes one again, and
    // the bold word is still one bold word.
    const paragraphs = async () => {
      const value: unknown = JSON.parse((await written(request, lead)) ?? "0");
      return Array.isArray(value) ? value.length : -1;
    };
    await page.keyboard.press("Enter");
    await expect.poll(paragraphs).toBe(2);
    await page.keyboard.press("Backspace");
    await expect.poll(paragraphs).toBe(1);
    await expect
      .poll(() => written(request, lead))
      .toMatch(/"styles":\["bold"\],"children":\["[Val]*X[Val]*"\]/);
    await expect
      .poll(() => written(request, lead))
      .toContain(" from a file next to the route that renders it.");
  });
});

/**
 * The front page again, for its length: seventeen fields, so the column has
 * somewhere to scroll to.
 */
test.describe("a text typed in on the page, in the column", () => {
  test.use({ viewport: { width: 1512, height: 900 } });

  test("the column turns to the page's fields and scrolls to the one being typed in", async ({
    page,
  }) => {
    await openStudio(page);
    await page.getByRole("button", { name: "Open the canvas" }).click();
    const preview = await selectOnPreview(page, "edit");
    // The last thing on the page, and so the last row of the column.
    const footer = preview.locator("footer");
    await footer.scrollIntoViewIfNeeded();
    await footer.click();
    const copy = inlineEditor(preview);
    await expect(copy, "the caret did not go into the footer").toBeFocused();

    const row = columnRow(page, '?p="footer"');
    await expect(
      row,
      "the column did not scroll to the field",
    ).toBeInViewport();
    await page.keyboard.press("End");
    await page.keyboard.type(", typed on the page");
    await expect(row.locator("input")).toHaveValue(
      "Built with Val Build, typed on the page",
    );
    // The column showing it did not take the caret from the page.
    await expect(copy).toBeFocused();
  });
});

/**
 * And the front page's prose block, whose richtext allows headings and
 * lists: the controls that change what a paragraph IS.
 */
test.describe("the floating controls, on a richtext with headings", () => {
  test.use({ viewport: { width: 1512, height: 900 } });

  test("a paragraph is made a heading from the menu, and typing goes on in it", async ({
    page,
    request,
  }) => {
    await openStudio(page);
    await page.getByRole("button", { name: "Open the canvas" }).click();
    const preview = await selectOnPreview(page, "edit");
    await preview.getByText("The blocks below are one").first().click();
    const copy = inlineEditor(preview);
    await expect(copy).toBeFocused();
    const toolbar = inlineToolbar(page);
    // What the field's schema allows, and nothing it does not: headings,
    // marks, links and lists, and no image button.
    await expect(toolbar.getByTitle(/Bullet list/)).toBeVisible();
    await expect(toolbar.getByTitle(/Insert image/)).toHaveCount(0);

    await toolbar.getByRole("button", { name: "Normal" }).click();
    // Normal, H2, H3: the third.
    await page.getByRole("menuitem").nth(2).click();
    const body = ["/", "blocks", "0", "body"];
    await expect
      .poll(() => written(request, body))
      .toMatch(/\{"tag":"h3","children":\["The blocks below are one /);
    await expect(copy.locator("h3")).toContainText("The blocks below are one");
    // The image the block holds is still there.
    await expect(copy.locator("img")).toHaveCount(1);
    // The menu closing did not keep the focus: the next keys are the text's.
    await expect(copy).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" Typed after.");
    /*
     * In the heading, and nothing else of it changed. Not "after its last
     * word": End goes to the end of the line the caret is on, and where a
     * heading wraps depends on the fonts of the machine this runs on.
     */
    const heading = async () => {
      const value: unknown = JSON.parse((await written(request, body)) ?? "[]");
      const text = (node: unknown): string => {
        if (typeof node === "string") return node;
        if (typeof node !== "object" || node === null) return "";
        const children: unknown = Reflect.get(node, "children");
        return Array.isArray(children) ? children.map(text).join("") : "";
      };
      const h3 = Array.isArray(value)
        ? value.find(
            (node: unknown) =>
              typeof node === "object" &&
              node !== null &&
              Reflect.get(node, "tag") === "h3",
          )
        : undefined;
      return text(h3);
    };
    await expect.poll(heading).toContain(" Typed after.");
    expect((await heading()).replace(" Typed after.", "")).toBe(
      "The blocks below are one array of a discriminated union, rendered inline.",
    );
  });
});

/**
 * The front page's call to action, whose label may not start or end with a
 * space (`.regexp` in `_site.index.val.ts`): a rule only the showcase has.
 */
test.describe("a field's validation errors, by the text typed in on the page", () => {
  test.use({ viewport: { width: 1512, height: 900 } });

  test("an error shows by the text as it is typed, and goes when it is fixed", async ({
    page,
    request,
  }) => {
    await openStudio(page);
    await page.getByRole("button", { name: "Open the canvas" }).click();
    const preview = await selectOnPreview(page, "edit");
    await preview.getByRole("link", { name: "Read the docs" }).click();
    const copy = inlineEditor(preview);
    await expect(copy, "the caret did not go into the label").toBeFocused();
    const errors = page.getByLabel(
      "Validation errors for the text on the page",
    );
    await expect(errors).toHaveCount(0);

    await page.keyboard.press("End");
    await page.keyboard.type(" ");
    await expect(errors).toContainText("No leading or trailing whitespace");
    // By the text and not over it, and inside the preview.
    const message = await errors.boundingBox();
    const text = await copy.boundingBox();
    const frame = await page
      .locator('iframe[title^="Preview of"]')
      .boundingBox();
    if (message === null || text === null || frame === null) {
      throw new Error("the message, the text or the preview has no box");
    }
    const above = message.y + message.height <= text.y;
    const below = message.y >= text.y + text.height;
    expect(above || below, "the message is over the text").toBe(true);
    expect(
      Math.abs(above ? text.y - message.y : message.y - text.y),
    ).toBeLessThan(200);
    expect(message.y).toBeGreaterThanOrEqual(frame.y);
    expect(message.x).toBeGreaterThanOrEqual(frame.x);
    expect(message.x + message.width).toBeLessThanOrEqual(
      frame.x + frame.width,
    );
    // The column's row says the same.
    await expect(columnRow(page, '."ctaLabel"')).toContainText(
      "No leading or trailing whitespace",
    );
    // Showing it did not take the caret.
    await expect(copy).toBeFocused();

    await page.keyboard.press("Backspace");
    await expect(errors).toHaveCount(0);
    await expect(copy).toBeFocused();
    await page.keyboard.type("!");
    await expect
      .poll(() => written(request, ["/", "hero", "ctaLabel"]))
      .toBe(JSON.stringify("Read the docs!"));
  });
});
