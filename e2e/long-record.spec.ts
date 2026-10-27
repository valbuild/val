import { expect } from "@playwright/test";
import { openStudio, test } from "./studio";

/**
 * A record with a thousand entries, and where its scrollbar ends.
 *
 * The list virtualizes into a scroll viewport of its own, which was a fixed
 * 800px box inside the editor's own scroller. Two scrollbars, and the outer one
 * moves the whole list — so scrolling anywhere except exactly inside the box
 * heaves a thousand rows up and down. It has to end where the column does.
 */
test.describe("a long record list", () => {
  test("fits the column instead of scrolling inside it", async ({ page }) => {
    await openStudio(page, "/val/~/content/kb.val.ts");

    const column = page.locator("#val-content-area");
    // The list's own scroll viewport: the only scrollable box inside the column.
    const list = column.locator("div[style*='contain: strict']").first();
    await expect(list).toBeVisible({ timeout: 30000 });

    const listBox = await list.boundingBox();
    const columnBox = await column.boundingBox();
    if (listBox === null || columnBox === null) {
      throw new Error("expected the list and the column to be laid out");
    }

    // It reaches the bottom of the column, give or take the gutter under it.
    const slack = columnBox.y + columnBox.height - (listBox.y + listBox.height);
    expect(slack).toBeLessThan(48);
    expect(slack).toBeGreaterThan(-2);

    /**
     * And what is left to scroll in the column is furniture, not the list.
     *
     * Not zero: the module's header sits above the list and the column keeps its
     * own bottom padding, so a few hundred pixels of the column can still move.
     * The claim is that the LIST is not what the outer scrollbar drags — it used
     * to be a fixed 800px box in a column several thousand pixels tall.
     */
    const overflow = await column.evaluate(
      (node) => node.scrollHeight - node.clientHeight,
    );
    expect(overflow).toBeLessThan(320);
    expect(overflow).toBeLessThan(listBox.height);
  });
});
