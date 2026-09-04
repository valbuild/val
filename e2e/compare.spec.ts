import { expect, test } from "@playwright/test";
import { clearPatchChain, openStudio } from "./studio";
import type { Locator, Page } from "@playwright/test";

/**
 * Reach the compare view the way an editor does.
 *
 * A `page.goto("/val/compare")` looks equivalent and is not: it reloads the SPA,
 * throwing away the intake `openStudio` waited for AND the pending edit the view
 * is supposed to be showing. Review is the route in, and it only appears once
 * there is something to review — so clicking it is also the wait for the edit
 * having landed.
 *
 * At this viewport that control is in the top bar, next to Publish. It used to
 * be inside the Quick actions panel; the panel now carries it on mobile only,
 * because two controls with the same accessible name on one screen is
 * ambiguous to a screen reader and a second place to look for everyone else.
 */
async function openCompare(page: Page, studio: Locator): Promise<void> {
  const review = studio.getByRole("button", { name: /Review \d+ change/ });
  await expect(review).toBeVisible({ timeout: 30000 });
  await review.click();
}

/**
 * The compare view: what it shows, and what it refuses to let you do.
 *
 * Two claims, both of which were once false.
 */
test.describe("the compare view", () => {
  test.beforeEach(async ({ request }) => {
    await clearPatchChain(request);
  });

  /**
   * Nothing in it is editable.
   *
   * Typing into the "After" side used to work, which reads as a feature and is
   * not one: the value under the cursor is the result of a chain of patch sets,
   * each with its own author and its own Discard, so an edit made here belongs to
   * none of them and lands as a further patch on top — while the row it was typed
   * into goes on describing the change it used to describe.
   *
   * The Discard controls are NOT part of that: reviewing and discarding is what
   * the view is for. They shared one boolean with editing, so this asserts both
   * halves — no writable field, and a Discard still there.
   */
  test("shows the change without offering to edit it", async ({ page }) => {
    await openStudio(page, "/val/~/content/kb.val.ts?p=%22kb-000%22");
    const studio = page.locator("#val-shadow-root");

    // A real pending change to look at.
    const editor = studio.getByRole("textbox").first();
    await expect(editor).toBeVisible({ timeout: 30000 });
    await editor.fill("Compared title");

    await openCompare(page, studio);
    const rows = studio.locator("article[data-val-studio-path]");
    await expect(rows.first()).toBeVisible({ timeout: 30000 });

    /*
     * The change is on screen — the guard that keeps the rest non-vacuous.
     *
     * On the VALUE, not on the presence of a field. A read-only value in a
     * dense row is rendered as text rather than as a disabled input: an input
     * is `inert` here, so a line longer than the box could not be focused,
     * scrolled or even selected, and the rest of it was unreachable. So
     * "there is at least one field" is no longer the same question as "there
     * is something to look at", and it is the second one this view is for.
     */
    const afterSide = studio
      .locator("article[data-val-studio-path] [data-val-compare-side='after']")
      .first();
    await expect(afterSide).toContainText("Compared title");

    /*
     * No field in the view can be written to — counted, not sampled.
     *
     * "Cannot be written to" has three implementations in this codebase and
     * the check has to accept all of them, or it asserts the mechanism instead
     * of the behaviour: a `readOnly`/`disabled` attribute; `ReadonlyGuard`,
     * which wraps the field in an `inert` div (the input keeps its attributes
     * and stops receiving events); or no field at all, which is what a
     * read-only value in a dense row now renders as. Only the guard is what a
     * `readonly` field actually gets, which is why an attribute-only check
     * passed a field nobody can type in — and would keep passing if the guard
     * were removed.
     *
     * Zero fields is a pass, and safely: the assertion above has already
     * established that the value is on screen, so this cannot be vacuous by
     * the view having rendered nothing.
     */
    const inputs = studio.locator(
      "article[data-val-studio-path] input, article[data-val-studio-path] textarea, article[data-val-studio-path] [contenteditable='true']",
    );
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const writable = await input.evaluate((node) => {
        if (node.closest("[inert]") !== null) return false;
        if (node.getAttribute("contenteditable") === "true") return true;
        const field = node as HTMLInputElement | HTMLTextAreaElement;
        return !field.readOnly && !field.disabled;
      });
      if (writable) {
        throw new Error(
          `a field in the compare view is writable: ${await input.evaluate(
            (node) => node.outerHTML.slice(0, 200),
          )}`,
        );
      }
    }

    // And the behaviour itself, on the "After" side, which is the one that used
    // to take an edit: clicking at it and typing changes nothing it shows.
    const beforeTyping = await afterSide.innerText();
    await afterSide.click({ force: true, timeout: 5000 }).catch(() => {
      // An inert subtree may refuse the click outright, which is the same
      // answer.
    });
    await page.keyboard.type("nope");
    expect(await afterSide.innerText()).toBe(beforeTyping);

    // And discarding is still offered — it is what this view is for.
    await expect(studio.getByLabel(/Discard/).first()).toBeVisible();
  });

  /**
   * A `.jsonValues()` entry shows what it WAS, not what it is now.
   *
   * The before side is read from the base realm, and for a `.jsonValues()` module
   * the value is not in source — it is substituted in from the entry map on read.
   * That map held only the patched content, so the base realm substituted the
   * edit into the base source and answered with it: both sides showed the same
   * value, for `.jsonValues()` modules only.
   */
  test("shows the previous value for a jsonValues entry", async ({ page }) => {
    await openStudio(page, "/val/~/content/kb.val.ts?p=%22kb-000%22");
    const studio = page.locator("#val-shadow-root");

    const title = studio.getByRole("textbox").first();
    await expect(title).toBeVisible({ timeout: 30000 });
    const before = await title.inputValue();
    expect(before).not.toBe("");
    const after = `${before} edited`;
    await title.fill(after);

    await openCompare(page, studio);
    const row = studio.locator("article[data-val-studio-path]").first();
    await expect(row).toBeVisible({ timeout: 30000 });

    /*
     * Each value on its OWN side, which is the whole point of a before/after.
     *
     * Read off the rendered text, because a read-only value in a dense row is
     * text now rather than an input. And per side rather than "both strings
     * are somewhere in the row": `after` here is `before` plus a suffix, so a
     * row-wide `toContain(before)` would pass on the after value alone and the
     * test would survive both sides showing the new one — which is the bug it
     * was written for.
     */
    const side = (which: "before" | "after") =>
      row.locator(`[data-val-compare-side='${which}']`).first();
    await expect(side("before")).toContainText(before);
    await expect(side("after")).toContainText(after);
    expect(await side("before").innerText()).not.toContain(after);
  });
});
