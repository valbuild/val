import { expect } from "@playwright/test";
import { openStudio, test } from "./studio";

/**
 * The phone's canvas layout.
 *
 * Two things were wrong and both are measured rather than eyeballed, because
 * both are "how much space" questions that a screenshot review passes.
 */
const HOME = "/val/~/app/page.val.ts?p=%22%2F%22";

test.use({ viewport: { width: 390, height: 844 } });

test.describe("the canvas on a phone", () => {
  test("starts the editor column directly below the switches", async ({
    page,
  }) => {
    await openStudio(page, `${HOME}&canvas=1`);

    const strip = page.getByRole("tablist", { name: "Workspace pane" });
    await expect(strip).toBeVisible();
    const stripBox = await strip.boundingBox();
    // The scroller, not the first field: what is measured here is the empty
    // space the LAYOUT adds, and how tall the module's own header happens to be
    // is a separate question (and a separate task).
    const column = page.locator("#val-content-area");
    const columnBox = await column.boundingBox();
    if (stripBox === null || columnBox === null) {
      throw new Error("expected the strip and the column to be laid out");
    }

    /**
     * The pane already reserves room for the top bar AND this strip, so the
     * column's own top padding is pure duplication — 80px of it, which put the
     * switches in the middle of an empty band instead of just above the
     * content.
     */
    const gap = columnBox.y - (stripBox.y + stripBox.height);
    expect(gap).toBeLessThan(24);
    expect(gap).toBeGreaterThan(-2);

    // And the padding inside it is a hairline, not a second clearance.
    const paddingTop = await column.evaluate((node) =>
      parseFloat(
        getComputedStyle(node.firstElementChild as HTMLElement).paddingTop,
      ),
    );
    expect(paddingTop).toBeLessThan(16);
  });

  test("puts the pane switch on the right of the strip", async ({ page }) => {
    await openStudio(page, `${HOME}&canvas=1`);

    const pane = page.getByRole("tablist", { name: "Workspace pane" });
    await expect(pane).toBeVisible();
    const paneBox = await pane.boundingBox();
    const viewport = page.viewportSize();
    if (paneBox === null || viewport === null) {
      throw new Error("expected the pane switch to be laid out");
    }

    /**
     * Which pane you are LOOKING at goes right; what that pane HOLDS goes left.
     * The two were the other way round, which read backwards against the
     * desktop layout — where the view switch sits at the top of the column it
     * changes and the canvas is the thing off to the right.
     *
     * Checked as "the pane switch is right-aligned" rather than by comparing the
     * two switches, because the view switch is only there once the page has
     * reported what is on it: on a phone that can take a while, and a test that
     * waits for it is a test about the canvas, not about this row.
     */
    expect(paneBox.x).toBeGreaterThan(viewport.width / 2);
    expect(paneBox.x + paneBox.width).toBeGreaterThan(viewport.width - 24);
  });
});
