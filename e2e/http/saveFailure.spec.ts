import { expect, test, type Locator, type Page } from "@playwright/test";
import { mock, openHttpStudio, sessionCookie } from "./httpMode";

/**
 * A save the content service fails to take.
 *
 * Found by running `examples/tanstack` in proxy mode against `home`'s
 * self-hosted engine, which answered the save with a 500 -- `column
 * "first_paid_at" does not exist`. What the editor saw:
 *
 * - the field went back to its OLD value, as if the edit had been undone;
 * - the status bar went on saying "All changes saved";
 * - nothing said the edit was lost, or what to do.
 *
 * Because `ValServer` turned the content service's 500 into a 400
 * `patch-error`, and a 400 is what the Studio reads as a BAD PATCH, which it
 * drops. Nothing was wrong with the patch. The service failed, and these pin
 * what the Studio does about that now: keep what was typed, say the save
 * failed and why, and send it again on Try again.
 *
 * Run against `e2e/mock-content-host`'s `fail-patches` switch, which answers
 * the way `home` does when a handler throws.
 */

const KB_ENTRY = "/val/~/content/kb.val.ts?p=%22kb-000%22";

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.beforeEach(async () => {
  await mock.reset();
});

test.afterEach(async () => {
  // Every later spec in the run talks to the same mock.
  await mock.failPatches({ save: false, read: false });
});

/** The first text input of the entry, once the Studio has it on screen. */
async function editorOf(page: Page): Promise<Locator> {
  const studio = page.locator("#val-shadow-root");
  const editor = studio.getByRole("textbox").first();
  await expect(editor).toBeVisible({ timeout: 30000 });
  return editor;
}

function failureNotice(page: Page): Locator {
  return page
    .locator("#val-shadow-root")
    .getByRole("alert", { name: "Your changes could not be saved" });
}

test.describe("a save the content service fails to take", () => {
  test("says the save failed, and keeps what was typed", async ({ page }) => {
    await openHttpStudio(page, KB_ENTRY);
    const editor = await editorOf(page);
    await mock.failPatches({ save: true });

    await editor.fill("Typed while the service was failing");

    const notice = failureNotice(page);
    await expect(notice).toBeVisible({ timeout: 30000 });
    // In the service's name, not the editor's network.
    await expect(notice).toContainText("answered with an error");
    await expect(notice).not.toContainText(/network|connection/i);
    // The cause, for whoever they ask, under Details.
    await notice.getByText("Details").click();
    await expect(notice).toContainText('column "first_paid_at" does not exist');
    await expect(
      page
        .locator("#val-shadow-root")
        .getByText("Could not save", { exact: true }),
    ).toBeVisible();

    // The edit is still there: on screen, and in the store.
    await expect(editor).toHaveValue("Typed while the service was failing");
    expect(
      (await mock.state()).patches,
      "the mock was failing every save, so nothing should have landed",
    ).toHaveLength(0);
  });

  test("never says All changes saved while the save has failed", async ({
    page,
  }) => {
    await openHttpStudio(page, KB_ENTRY);
    const editor = await editorOf(page);
    const saved = page
      .locator("#val-shadow-root")
      .getByText("All changes saved", { exact: true });
    await expect(saved).toBeVisible({ timeout: 30000 });
    await mock.failPatches({ save: true });

    await editor.fill("This save will fail");
    await expect(failureNotice(page)).toBeVisible({ timeout: 30000 });

    /*
     * Watched for a while rather than checked once: the old bug was the bar
     * SETTLING on "All changes saved" after the drop, and the status bar holds
     * "Saving…" for a moment before it settles on anything.
     */
    for (let check = 0; check < 10; check++) {
      await expect(saved).toBeHidden();
      await page.waitForTimeout(300);
    }
    await expect(editor).toHaveValue("This save will fail");
  });

  test("Try again saves it once the service has recovered", async ({
    page,
  }) => {
    await openHttpStudio(page, KB_ENTRY);
    const editor = await editorOf(page);
    await mock.failPatches({ save: true });

    await editor.fill("Saved on the second go");
    const notice = failureNotice(page);
    await expect(notice).toBeVisible({ timeout: 30000 });

    await mock.failPatches({ save: false });
    await notice.getByRole("button", { name: "Try again" }).click();

    await expect
      .poll(async () => (await mock.state()).patches.length, {
        message: "Try again did not send the save",
        timeout: 30000,
      })
      .toBeGreaterThan(0);
    await expect(notice).toBeHidden();
    await expect(
      page
        .locator("#val-shadow-root")
        .getByText("All changes saved", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(editor).toHaveValue("Saved on the second go");
  });
});

test.describe("the patches request answered with an error", () => {
  test("is not blamed on the editor's network", async ({ page }) => {
    await openHttpStudio(page, KB_ENTRY);
    await mock.failPatches({ read: true });

    // Asked the way the Studio asks, as the signed-in editor.
    const res = await page.request.get(
      "/api/val/patches?patch_id=00000000-0000-4000-8000-000000000000",
    );
    expect(res.status()).toBe(500);
    const body = (await res.json()) as { message: string; details?: string };

    expect(body.message).toContain("answered with an error");
    expect(body.message).not.toMatch(/network|connection/i);
    // The status and the service's words, kept for Details.
    expect(body.details).toContain("HTTP 500");
    expect(body.details).toContain('column "first_paid_at" does not exist');
  });
});
