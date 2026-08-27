import { expect, test } from "@playwright/test";
import { clearPatchChain, openStudio } from "./studio";

/**
 * A record key's description: said once, and next to the thing it describes.
 *
 * `ChangeRecordPopover` rendered it twice — once on the `keyDescription` prop and
 * again in the rename branch on the same value resolved through the schema — so
 * every caller that passes the prop, which the rename control does, showed it
 * doubled. And in the header it had ended up UNDER the scope trail, where it read
 * as a note about the path rather than about the key being edited.
 */
const ENTRY = "/val/~/content/authors.val.ts?p=%22teddy%22";
const DESCRIPTION = "Unique identifier for the author";

test.describe("a record key's description", () => {
  test.beforeEach(async ({ request }) => {
    await clearPatchChain(request);
  });

  test("sits under the title, above the scope", async ({ page }) => {
    await openStudio(page, ENTRY);
    const studio = page.locator("#val-shadow-root");

    const description = studio.getByText(DESCRIPTION);
    await expect(description).toHaveCount(1);

    /*
     * Compared by position on the page rather than by DOM order: what was wrong
     * was where it APPEARED, and a reader cares about the y coordinate.
     */
    const heading = studio.getByRole("heading", { level: 1 });
    const scope = studio.getByRole("navigation", { name: "Scope" });
    const [titleBox, descriptionBox, scopeBox] = await Promise.all([
      heading.boundingBox(),
      description.boundingBox(),
      scope.boundingBox(),
    ]);
    expect(titleBox).not.toBeNull();
    expect(descriptionBox).not.toBeNull();
    expect(scopeBox).not.toBeNull();
    expect(descriptionBox!.y).toBeGreaterThan(titleBox!.y);
    expect(scopeBox!.y).toBeGreaterThan(descriptionBox!.y);
  });

  test("is said once in the rename popover, not twice", async ({ page }) => {
    await openStudio(page, ENTRY);
    const studio = page.locator("#val-shadow-root");
    await expect(studio.getByText(DESCRIPTION)).toHaveCount(1);

    // The rename control, by the popover it opens: the trigger is an icon whose
    // only accessible name comes from its tooltip.
    await studio.locator('[aria-haspopup="dialog"]').first().click();

    /*
     * Asserted INSIDE the popover, which is where the duplicate was. Counting
     * across the page would also pick up the header's copy and make the number
     * depend on two unrelated decisions.
     */
    const popover = studio.getByRole("dialog");
    await expect(popover.getByRole("textbox")).toHaveValue("teddy");
    await expect(popover.getByText(DESCRIPTION)).toHaveCount(1);
  });
});
