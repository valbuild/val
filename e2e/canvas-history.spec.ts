import { expect } from "@playwright/test";
import { openStudio, test } from "./studio";

/**
 * Leaving the canvas is somewhere you were.
 *
 * Every part of the shell's view state was written with `replaceState`, on the
 * grounds that chrome is not history. That is right for a panel and wrong for
 * the canvas: closing it left nothing to go back to, and pressing back instead
 * took the editor out of the module they were working in.
 *
 * Both halves are checked here because either alone is useless: the entry has to
 * be pushed, AND the shell has to adopt the state the entry names. A push with
 * no restore is a back button that changes the URL and nothing else, which is
 * worse than one that does nothing at all.
 */
const HOME = "/val/~/app/page.val.ts?p=%22%2F%22";

test.describe("the canvas and the back button", () => {
  test("closing the canvas can be undone by going back", async ({ page }) => {
    await openStudio(page, `${HOME}&canvas=1`);
    // The canvas is open: its close control is the one thing only it has.
    const exit = page.getByLabel("Exit Preview");
    await expect(exit).toBeVisible();

    await exit.click();
    // Hidden, not removed: the pane stays mounted so opening it can animate,
    // and `visibility` is what takes it out of the tab order. See
    // `PageWorkspace`.
    await expect(exit).toBeHidden();
    // The write is throttled, so the entry lands shortly after the click.
    await expect.poll(() => page.url()).not.toContain("canvas=1");

    await page.goBack();

    await expect(exit).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("canvas=1");
  });

  test("and forward closes it again", async ({ page }) => {
    await openStudio(page, `${HOME}&canvas=1`);
    const exit = page.getByLabel("Exit Preview");
    await expect(exit).toBeVisible();
    await exit.click();
    await expect(exit).toBeHidden();
    await expect.poll(() => page.url()).not.toContain("canvas=1");
    await page.goBack();
    await expect(exit).toBeVisible({ timeout: 10000 });

    await page.goForward();
    await expect(exit).toBeHidden();
  });

  /**
   * And the rule that made all of this `replaceState` in the first place still
   * holds: opening a panel is not a place. If it were, the back button after a
   * few clicks around the chrome would be many presses away from the page.
   *
   * Counted through `history.length` rather than by pressing back: back from the
   * only entry there is leaves the page entirely, which would pass this test for
   * the wrong reason.
   */
  /**
   * QUARANTINED - see https://github.com/valbuild/val/issues/569.
   *
   * Timing-based by construction: the `waitForTimeout(1000)` below is waiting
   * for the shell's own fitted-position write, and the baseline is only correct
   * if that write landed inside it. Late, and the shell's entry is counted as
   * this test's. The fix is to wait for a quiet `history.length` rather than for
   * a duration - this asserts a DELTA, so it needs a settled baseline, not a
   * fixed delay.
   */
  test.skip("opening a panel is not a history entry", async ({ page }) => {
    await openStudio(page, HOME);
    // After the shell has written its own state once: landing writes the
    // canvas's fitted position, and that write is not what is being tested.
    await page.waitForTimeout(1000);
    const before = await page.evaluate(() => history.length);

    await page.getByLabel("Quick actions").click();
    await expect.poll(() => page.url()).toContain("panel=utility");

    expect(await page.evaluate(() => history.length)).toBe(before);
  });

  /** The canvas, by the same measure: one entry, not none and not two. */
  /** QUARANTINED - same sleep-then-measure baseline as above. See https://github.com/valbuild/val/issues/569. */
  test.skip("closing the canvas is exactly one history entry", async ({
    page,
  }) => {
    await openStudio(page, `${HOME}&canvas=1`);
    const exit = page.getByLabel("Exit Preview");
    await expect(exit).toBeVisible();
    await page.waitForTimeout(1000);
    const before = await page.evaluate(() => history.length);

    await exit.click();
    await expect(exit).toBeHidden();
    await expect.poll(() => page.url()).not.toContain("canvas=1");

    expect(await page.evaluate(() => history.length)).toBe(before + 1);
  });
});
