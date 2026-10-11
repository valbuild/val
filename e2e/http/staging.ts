import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Driving the review screen's staging controls, shared by the suites that
 * need a stage or an unstage to go through the controls an editor has.
 */

/**
 * Reach the review screen the way an editor does.
 *
 * `page.goto("/val/compare")` looks equivalent and is not: it reloads the SPA,
 * throwing away the intake and the pending edit the view exists to show. Review
 * is the route in, and it only appears once there is something to review — so
 * clicking it is also the wait for the edit having landed.
 *
 * The name is matched WITHOUT requiring a count, unlike the `fs` suite's
 * version. Review's badge is `hasNetChanges ? pendingChanges : 0`, and a held
 * patch makes the scoped source equal base — so once everything is unstaged the
 * button is still there and still works, but it reads "Review changes" rather
 * than "Review 1 change". Requiring the digits made this test unable to reach
 * the one screen a held change can be put back from.
 */
export async function openReview(page: Page, studio: Locator): Promise<void> {
  const review = studio.getByRole("button", {
    name: /^Review( \d+)? changes?$/,
  });
  await expect(review).toBeVisible({ timeout: 30_000 });
  await review.click();
}

/**
 * The rows of one half of the review page.
 *
 * SCOPED, and that is the whole point of this helper. The page lists staged
 * rows above unstaged ones, so "the first checkbox" is whichever half happens
 * to be non-empty — and pressing Stage on an already-staged row is a no-op
 * that leaves the assertion to fail three steps later, naming the group rather
 * than the click. The old per-row buttons could not be got wrong this way: a
 * Stage button only existed on a row that was unstaged.
 */
export function rowsIn(
  studio: Locator,
  section: "Staged" | "Unstaged",
): Locator {
  /*
   * By the info button's label, through CSS `:has()`.
   *
   * Not `filter({ has: getByRole("heading") })`: an inner locator built from
   * the shadow-root handle does not re-root onto the section, so it matched
   * nothing and the failure read as "no staging control" over a screenshot
   * plainly showing one. And not `:has-text("Staged")` either — that matches
   * "Unstaged" as a substring, which is the same bug the other way round. An
   * attribute selector is exact.
   */
  return studio
    .locator(`section:has([aria-label="What ${section.toLowerCase()} means"])`)
    .getByRole("checkbox");
}

/**
 * Act on one change, through the controls an editor actually has.
 *
 * The review page separates SELECTING from ACTING — a tick box per row, and
 * one button for whatever is ticked — because one control cannot answer both
 * "is this going out" and "am I about to change that". So this is two
 * gestures, and it has to be: a test that reached past the selection would be
 * asserting on a button the user cannot press without first choosing what it
 * applies to.
 */
export async function actOnFirstRow(
  studio: Locator,
  action: "Stage" | "Unstage",
  absentMessage: string,
): Promise<void> {
  // Stage acts on an UNSTAGED row and vice versa.
  const row = rowsIn(
    studio,
    action === "Stage" ? "Unstaged" : "Staged",
  ).first();
  await expect(row, absentMessage).toBeVisible({ timeout: 30_000 });
  await row.click();
  const button = studio.getByRole("button", { name: action, exact: true });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
}
