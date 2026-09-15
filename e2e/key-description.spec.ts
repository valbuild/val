import { expect, test } from "@playwright/test";
import { clearPatchChain, openStudio } from "./studio";

/**
 * A record key's description: said once, and only where the key is ENTERED.
 *
 * `ChangeRecordPopover` rendered it twice — once on the `keyDescription` prop and
 * again in the rename branch on the same value resolved through the schema — so
 * every caller that passes the prop, which the rename control does, showed it
 * doubled. The header showed it a third time, and that one was not a duplicate
 * but a category error: a description is INPUT HELP, and nothing about this key
 * can be typed from the heading. See the rule at the top of `core/src/preview.ts`.
 */
const ENTRY = "/val/~/content/authors.val.ts?p=%22teddy%22";
const DESCRIPTION = "Unique identifier for the author";

test.describe("a record key's description", () => {
  test.beforeEach(async ({ request }) => {
    await clearPatchChain(request);
  });

  test("is not in the header, where the key cannot be edited", async ({
    page,
  }) => {
    await openStudio(page, ENTRY);
    const studio = page.locator("#val-shadow-root");

    /*
     * The heading and the trail first, so an empty result below means the
     * description is genuinely absent rather than the header never having
     * rendered.
     */
    await expect(studio.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      studio.getByRole("navigation", { name: "Scope" }),
    ).toBeVisible();

    /*
     * "The URL of this blog post. Lower case, no spaces." under a title reads
     * as a caption of that title — and once the title is a `.preview(...)` name
     * rather than the key, it captions the wrong thing entirely. The guidance
     * is not lost: every form that ASKS for a key shows it, including the
     * rename form reachable from the tools on this very row.
     */
    await expect(studio.getByText(DESCRIPTION)).toHaveCount(0);
  });

  test("the folder in the trail is not a link", async ({ page }) => {
    await openStudio(page, ENTRY);
    const studio = page.locator("#val-shadow-root");
    const scope = studio.getByRole("navigation", { name: "Scope" });

    // `/content/authors.val.ts` reads as `Content / Authors`, and both segments
    // carry the module's own path — so linking the folder offered a second route
    // to the same place under a name that is not a place.
    await expect(scope).toContainText("Content");
    await expect(scope.getByRole("link")).toHaveCount(1);
    await expect(scope.getByRole("link")).toContainText("Authors");
  });

  test("a module's own page offers no way up to its folder", async ({
    page,
  }) => {
    await openStudio(page, "/val/~/content/authors.val.ts");
    const studio = page.locator("#val-shadow-root");
    const scope = studio.getByRole("navigation", { name: "Scope" });

    // The level above a module is its directory, and "up" there navigated to the
    // module you were already looking at.
    await expect(scope).toContainText("Content");
    await expect(scope.getByRole("link")).toHaveCount(0);
    await expect(
      studio.getByRole("link", { name: /^Up one level/ }),
    ).toHaveCount(0);
  });

  test("is said once in the rename popover, not twice", async ({ page }) => {
    await openStudio(page, ENTRY);
    const studio = page.locator("#val-shadow-root");
    // Nowhere on the page yet — the header does not say it. See above.
    await expect(studio.getByText(DESCRIPTION)).toHaveCount(0);

    // The rename control, by the popover it opens: the trigger is an icon whose
    // only accessible name comes from its tooltip.
    await studio.locator('[aria-haspopup="dialog"]').first().click();

    /*
     * Asserted INSIDE the popover, which is where the duplicate was — and which
     * is the one place the sentence belongs, because it is the one place the
     * key is being typed.
     */
    const popover = studio.getByRole("dialog");
    await expect(popover.getByRole("textbox")).toHaveValue("teddy");
    await expect(popover.getByText(DESCRIPTION)).toHaveCount(1);
  });
});
