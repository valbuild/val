import { expect } from "@playwright/test";
import { openNavPanel, openStudio, test } from "./studio";

/**
 * The account, and what the studio does when it cannot load one.
 *
 * `/profiles` is the one request the studio makes that nothing depends on: it
 * supplies a name and an avatar for the people who made the changes, and every
 * field still edits and every patch still saves without it. That is exactly why
 * it went wrong quietly — against a misconfigured project it answered 404
 * "Project not found" and the studio retried it every two seconds, forever,
 * filling the console with the same stack and burying every other error.
 *
 * So there are two things to check, and the first is the one that matters: the
 * retrying stops. The second is that it stops in a way a person can act on.
 */

/** What a misconfigured project's `/profiles` actually answers. */
const PROFILES_FAILURE = JSON.stringify({
  message:
    'Profiles failed: 404 {"statusCode":404,"message":"Project not found"}',
});

test.describe("the account", () => {
  test("gives up on profiles, and says why", async ({ page }) => {
    let attempts = 0;
    await page.route("**/api/val/profiles", async (route) => {
      attempts++;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: PROFILES_FAILURE,
      });
    });

    await openStudio(page);
    const studio = await openNavPanel(page, "Settings");

    // The server's own words, not the wrapper it came in: "Project not found"
    // is something an editor can do something about.
    await expect(
      studio.getByText("Project not found"),
      "the account failure was never explained",
    ).toBeVisible({ timeout: 40000 });
    await expect(studio.getByText("Could not load your account")).toBeVisible();

    /**
     * Five attempts, and no more.
     *
     * The count is the assertion. A message on screen is compatible with a
     * retry loop still running behind it, which is the bug this replaced — so
     * the check is that the number stops moving.
     */
    expect(attempts).toBe(5);
    const settled = attempts;
    await expect
      .poll(() => attempts, {
        message: "the studio was still retrying profiles after giving up",
        timeout: 6000,
        intervals: [1000, 1000, 1000, 1000, 1000],
      })
      .toBe(settled);

    // And the way out: the next attempt succeeds, so the notice goes.
    await page.unroute("**/api/val/profiles");
    await studio.getByRole("button", { name: "Try again" }).click();
    await expect(
      studio.getByText("Could not load your account"),
      "retrying left the failure on screen",
    ).not.toBeVisible();
  });

  /**
   * Signing out of a session that does not exist.
   *
   * The example app runs in `fs` mode — Val reading and writing the working copy
   * on disk — where there is no session at all. The button was rendered anyway,
   * wired to a function that did nothing, which is worse than no button: the
   * only way to find out was to press it.
   */
  test("offers no sign out where there is no session", async ({ page }) => {
    await openStudio(page);
    const studio = await openNavPanel(page, "Settings");
    await expect(studio.getByText("Appearance")).toBeVisible();
    await expect(
      studio.getByRole("button", { name: "Sign out" }),
      "a dev-mode studio offered to end a session it does not have",
    ).not.toBeVisible();
  });
});
