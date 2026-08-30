import { expect } from "@playwright/test";
import { clearPatchChain, openStudio, test } from "./studio";

/**
 * Validation errors appear where the editing happens, and gate the publish.
 *
 * Typing an invalid value in the canvas's fields column showed NOTHING: no
 * message under the field, no error pill in the top bar, and a publish button
 * offering to ship it. Opening the same field on its own showed the error
 * immediately, which is what made it look like a rendering problem rather than
 * what it was — validation had stopped running for that module entirely.
 *
 * `ValidationStore` computes on demand and a patch marks the module stale. A
 * validation that was overtaken by an edit stored its result but stayed marked
 * stale, and the reader re-asks from an effect keyed on the result it rendered
 * — `peek` answers stale with one shared object, so stale → overtaken → stale
 * is the same object twice and the effect never re-ran. The store now finishes
 * the job itself, and every module with a pending change is validated whether or
 * not a field is on screen, because the publish gate is a question with no field
 * behind it.
 *
 * Driven through the canvas because that is where it was reported and where the
 * race is easiest to hit: opening it applies patches and pushes sources while
 * the first validation is still running.
 */

/** The example app's home page: `hero.title` is `s.string().minLength(4)`. */
const HOME = "/val/~/app/page.val.ts?p=%22%2F%22";
const TOO_SHORT = "Expected string to be at least 4 characters long";

test.describe("validation while editing", () => {
  // Per test, not per file: each one types into the same field, so a leftover
  // patch from the previous test IS the initial value the next one asserts on.
  test.beforeEach(async ({ request }) => {
    await clearPatchChain(request);
  });

  test("shows under the field in the canvas, and blocks the publish", async ({
    page,
  }) => {
    await openStudio(page, `${HOME}&canvas=1`);

    const title = page.locator("input").first();
    await expect(title).toHaveValue("Content as code");
    await title.fill("Foo");

    // Under the field, in the column being typed into.
    await expect(page.getByText(TOO_SHORT)).toBeVisible({ timeout: 15000 });

    // And the publish button itself is now the "fix this" control — the
    // separate error-triangle pill it used to sit beside was removed as a
    // second way to do the same thing (see `describePublishButton`).
    const fixButton = page.getByRole("button", { name: "Fix 1" });
    await expect(fixButton).toBeVisible({ timeout: 15000 });

    // Fixing it clears both, so the gate is not one-way.
    await title.fill("Long enough");
    await expect(page.getByText(TOO_SHORT)).toHaveCount(0, { timeout: 15000 });
    await expect(fixButton).toHaveCount(0);
  });

  /**
   * The publish gate does not depend on what is on screen.
   *
   * The edit is made, and then the studio is REOPENED on a view that renders
   * nothing of that module — no field for it is mounted anywhere. On-screen
   * demand is what used to compute validation, so this is the case where an
   * invalid pending change was invisible and the publish button offered to ship
   * it.
   */
  test("reports the error with no field for the module on screen", async ({
    page,
  }) => {
    await openStudio(page, `${HOME}&canvas=1`);
    const title = page.locator("input").first();
    await expect(title).toHaveValue("Content as code");
    await title.fill("Foo");
    // Wait for the patch to reach the SERVER, so the reload below sees it: the
    // write is debounced, and a reload beats it otherwise.
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/api/val/patches");
          const body = (await res.json()) as { patches: unknown[] };
          return body.patches.length;
        },
        { timeout: 15000, message: "the edit never reached the server" },
      )
      .toBeGreaterThan(0);

    // A fresh studio, on the settings panel, with no canvas and no module open.
    await openStudio(page, "/val?panel=settings");
    await expect(page.getByText(TOO_SHORT)).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Fix 1" })).toBeVisible({
      timeout: 15000,
    });
  });

  /**
   * The errors view lists each error once.
   *
   * It renders the real field so it can be fixed in place, and a field opened
   * on its own shows its own errors — so the row's list and the field's copy
   * were the same message twice, once above and once below. Counted rather than
   * merely asserted visible, which is the only way this failure shows up.
   */
  test("lists each error once in the errors view", async ({ page }) => {
    await openStudio(page, `${HOME}&canvas=1`);
    const title = page.locator("input").first();
    await expect(title).toHaveValue("Content as code");
    await title.fill("Foo");
    await expect(page.getByText(TOO_SHORT)).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "Fix 1" }).click();

    // The field is here to be fixed, and the message is here once.
    await expect(page.getByText("Validation errors")).toBeVisible();
    await expect(page.getByText(TOO_SHORT)).toHaveCount(1);
  });
});
