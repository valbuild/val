import { expect } from "@playwright/test";
import { openStudio, test } from "./studio";
import {
  defineInlineEditingSuite,
  inlineEditor,
  selectOnPreview,
  turnOnInlineEditing,
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
    await turnOnInlineEditing(page);
    await openStudio(page);
    await page.getByRole("button", { name: "Open the canvas" }).click();
    const preview = await selectOnPreview(page);
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
