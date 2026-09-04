import { expect, test, type Locator } from "@playwright/test";
import { contextAs, mock, openHttpStudio } from "./httpMode";

/**
 * Whose change is this?
 *
 * `fs` mode cannot ask: one writer, no session, and the Studio says "Local
 * changes". In proxy mode every patch carries an author, the Studio names it
 * from `/profiles`, and a patch with no author it can name reads as "Unknown
 * author" — so this is the one mode where getting it wrong is visible, and it
 * was wrong in exactly one direction.
 *
 * A patch made in the browser carried no author at all. The server stamps one
 * from the session cookie on `PUT /patches`, but the Studio fetches ops only for
 * ids it has no data for — so a record it made itself is never re-fetched and
 * never learned who wrote it. Every change went anonymous the moment it was
 * made, beside the ones already on the server, which were attributed correctly,
 * and a reload "fixed" it.
 *
 * Asserted on the NAME the review view shows rather than on the record, because
 * the name is the thing that was wrong: a record carrying the right author that
 * the Studio cannot put a name to is the same bug from the editor's side.
 */

const KB_ENTRY = "/val/~/content/kb.val.ts?p=%22kb-000%22";

/** What the mock's `/profiles` calls `profile-ada`, whose session these run as. */
const ADA = "Ada Lovelace";

/** What an avatar with no profile behind it says in proxy mode. */
const UNKNOWN = "Unknown author";

/**
 * Open the review view and the change history of the change in it.
 *
 * The history popover is where a name is written out rather than reduced to
 * initials or an id — `FieldPatchAuthorsPure` prints the profile's full name, or
 * the fallback this test is about. The avatars beside it carry the same name as
 * a `title`, but several of them are rendered offscreen for the collapsed
 * stacks, so the popover is the honest thing to assert on.
 *
 * Reached by clicking, the way an editor reaches it: Review only appears once
 * there is something to review, so this is also the wait for the edit having
 * become a patch.
 */
async function openChangeHistory(studio: Locator): Promise<void> {
  const review = studio.getByRole("button", { name: /Review \d+ change/ });
  await expect(review).toBeVisible({ timeout: 30000 });
  await review.click();
  const history = studio
    .getByRole("button", { name: "Change history" })
    .first();
  await expect(history).toBeVisible({ timeout: 30000 });
  await history.click();
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

test.describe("attribution of your own changes", () => {
  test("a change you have just made is credited to you, with no reload", async ({
    browser,
  }) => {
    const context = await contextAs(browser, "ada");
    const page = await context.newPage();
    try {
      await openHttpStudio(page, KB_ENTRY);
      const studio = page.locator("#val-shadow-root");

      const editor = studio.getByRole("textbox").first();
      await expect(editor).toBeVisible({ timeout: 30000 });
      await editor.fill("Ada typed this");

      await openChangeHistory(studio);

      // Ada is logged in as `profile-ada`, and the mock's `/profiles` gives that
      // id the name below — so this is the whole round trip: session cookie to
      // author id to a name on screen.
      await expect(studio.getByText(ADA).first()).toBeVisible({
        timeout: 30000,
      });
      await expect(studio.getByText(UNKNOWN)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  /**
   * The name does not change when the page comes back from the server.
   *
   * The client stamps the author it believes it is; the server stamps the one on
   * the session cookie. They are supposed to be the same author, and a reload is
   * what makes them comparable — after it, the record is the server's. A stamp
   * that guessed differently would show one name before the reload and another
   * after, which is worse than showing none.
   */
  test("and is still credited to you once the record comes from the server", async ({
    browser,
  }) => {
    const context = await contextAs(browser, "ada");
    const page = await context.newPage();
    try {
      await openHttpStudio(page, KB_ENTRY);
      const studio = page.locator("#val-shadow-root");

      const editor = studio.getByRole("textbox").first();
      await expect(editor).toBeVisible({ timeout: 30000 });
      await editor.fill("Ada typed this too");
      // The patch has to be ON the server before the reload, or there is nothing
      // to come back.
      await expect
        .poll(async () => (await mock.state()).patches.length, {
          message: "the edit never reached the content service",
          timeout: 30000,
        })
        .toBeGreaterThan(0);

      await openHttpStudio(page, KB_ENTRY);
      const reloaded = page.locator("#val-shadow-root");
      await openChangeHistory(reloaded);

      await expect(reloaded.getByText(ADA).first()).toBeVisible({
        timeout: 30000,
      });
      await expect(reloaded.getByText(UNKNOWN)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
