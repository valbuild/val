import { expect, test } from "@playwright/test";
import { clearPatchChain, navigateStudio, openStudio } from "./studio";

/**
 * Review, as a page, and a link to one change in it.
 *
 * `/val/review` shows what the pending changes change, and
 * `?compare=<source path>` opens it on that change. The media gallery's "View
 * in Compare" is the link that names a path. It used to open a dialog over a
 * list; the differences are the page now.
 */
test.describe("Review, and linking to a change in it", () => {
  test.beforeEach(async ({ request }) => {
    await clearPatchChain(request);
  });

  test("shows what a pending edit changes, and leads to the steps behind it", async ({
    page,
  }) => {
    await openStudio(page, "/val/~/content/kb.val.ts?p=%22kb-000%22");
    const studio = page.locator("#val-shadow-root");
    const editor = studio.getByRole("textbox").first();
    await expect(editor).toBeVisible({ timeout: 30000 });
    await editor.fill("Linked title");

    await navigateStudio(page, "/val/review");
    await expect(studio.getByRole("heading", { name: "Review" })).toBeVisible({
      timeout: 30000,
    });
    // The difference itself, on the page: no dialog to open first.
    await expect(studio.getByRole("dialog")).toHaveCount(0);
    await expect(studio.locator("[data-field-id]").first()).toContainText(
      "Linked title",
      { timeout: 30000 },
    );

    // Reverting is not done here. The way to where it is done is.
    await studio.getByRole("button", { name: "Changes and revert" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/val/changes");
    await expect(studio.getByRole("heading", { name: "Changes" })).toBeVisible({
      timeout: 30000,
    });
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
    // On the change the link named, marked, with what was typed in it.
    const row = studio.locator('[data-linked="true"]');
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row).toContainText("red-8x8_bfbd0.png");
    await expect(row).toContainText("A small red square");
  });
});
