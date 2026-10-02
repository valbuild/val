import { expect, test } from "@playwright/test";
import { clearPatchChain, navigateStudio, openStudio } from "./studio";

/**
 * The review page's compare dialog, as a link.
 *
 * `/val/review?compare` opens it, and `?compare=<source path>` opens it on that
 * change. The media gallery's "View in Compare" is the link that names a path,
 * and it used to go to the old `/val/compare` view and try to scroll.
 */
test.describe("linking into the compare dialog", () => {
  test.beforeEach(async ({ request }) => {
    await clearPatchChain(request);
  });

  test("a bare ?compare opens it, and closing it takes the param away", async ({
    page,
  }) => {
    await openStudio(page, "/val/~/content/kb.val.ts?p=%22kb-000%22");
    const studio = page.locator("#val-shadow-root");
    const editor = studio.getByRole("textbox").first();
    await expect(editor).toBeVisible({ timeout: 30000 });
    await editor.fill("Linked title");

    await navigateStudio(page, "/val/review?compare");
    const dialog = studio.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 30000 });
    await expect(dialog).toContainText("Linked title", { timeout: 30000 });

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => new URL(page.url()).searchParams.has("compare"))
      .toBe(false);
    expect(new URL(page.url()).pathname).toBe("/val/review");
  });

  test("the gallery's Compare link lands on that file's change", async ({
    page,
  }) => {
    const MODULE = "/content/mediaFixtures.val.ts";
    await openStudio(page, `/val/~${MODULE}`);
    const studio = page.locator("#val-shadow-root");
    // By name, so it is the same whether the gallery is in grid or list view.
    const file = studio.getByText("red-8x8_bfbd0.png", { exact: true });
    await expect(file.first()).toBeVisible({ timeout: 30000 });
    await file.first().click();
    await studio
      .getByPlaceholder("Describe this image...")
      .fill("A small red square");

    // Offered once the change is pending, which is when there is a diff.
    const link = studio.getByRole("link", { name: "View in Compare" });
    await expect(link).toBeVisible({ timeout: 30000 });
    await expect(link).toHaveAttribute("href", /^\/val\/review\?.*compare=/);
    await link.click();

    await expect
      .poll(() => new URL(page.url()).searchParams.get("compare"), {
        timeout: 10000,
      })
      .toBe(`${MODULE}?p="/public/test/subdir/red-8x8_bfbd0.png"`);
    const dialog = studio.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 30000 });
    // On the row for that file's alt, not merely somewhere in the dialog.
    const row = dialog.locator(`[data-compare-row*="red-8x8_bfbd0.png"]`);
    await expect(row.first()).toBeVisible({ timeout: 30000 });
    await expect(row.first()).toContainText("A small red square");
  });
});
