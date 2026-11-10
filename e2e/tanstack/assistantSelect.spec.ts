import { expect } from "@playwright/test";
import { openStudio, test } from "../studio";

/**
 * The two Selects, one each side of the preview (`SelectButton`).
 *
 * Content's is in Content's header and opens what it picks. The assistant's
 * is in the assistant's header and puts what it picks above the composer, to
 * go with the next message. They cross the frame both ways -- the Studio asks
 * the page to pick (`pickElements`, fields only outside code mode), and the
 * page answers with what was picked (`elementPicked`) -- so only a real page
 * in a real frame says they work.
 */
test.describe("pointing at the page", () => {
  test("the assistant's Select picks a field for the next message, once", async ({
    page,
  }) => {
    await openStudio(page);
    await page.getByRole("button", { name: "Open the canvas" }).click();
    // The canvas turns preview mode on by itself; the page reporting its
    // fields is when there is something to pick.
    await expect(page.getByRole("tab", { name: /On page \d/ })).toBeVisible({
      timeout: 60_000,
    });

    const contentSelect = page.getByRole("button", {
      name: "Select on the page",
    });
    await expect(
      contentSelect,
      "Content's Select is in its header",
    ).toBeVisible();
    await contentSelect.click();
    await expect(
      page.getByRole("button", { name: "Stop selecting on the page" }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "AI assistant" }).first().click();
    const assistantSelect = page.getByRole("button", {
      name: "Point the assistant at something on the page",
    });
    await assistantSelect.click();
    await expect(
      page.getByRole("button", { name: "Stop pointing the assistant" }),
    ).toHaveAttribute("aria-pressed", "true");
    // A click on the page has one owner.
    await expect(
      page.getByRole("button", { name: "Select on the page" }),
      "Content's Select stayed on while the assistant's picked",
    ).toHaveAttribute("aria-pressed", "false");

    const field = page
      .frameLocator('iframe[title^="Preview of"]')
      .locator("[data-val-path]")
      .first();
    await field.click();

    const chip = page.locator("[data-val-pointed-at]");
    await expect(chip, "the pick did not reach the composer").toBeVisible();
    // Named by its tag, as the page described it (`describeElement`).
    await expect(chip).toContainText(/<[a-z0-9]+>/);
    // Once, then off -- and the assistant's panel is still open: the click on
    // the page was a pick, not a click outside the panel.
    await expect(assistantSelect).toHaveAttribute("aria-pressed", "false");

    await page
      .getByRole("button", { name: "Do not send what you pointed at" })
      .click();
    await expect(chip).toHaveCount(0);
  });
});
