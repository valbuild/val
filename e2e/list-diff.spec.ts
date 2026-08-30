import { expect, test } from "@playwright/test";
import { clearPatchChain, openStudio, patchThroughStore } from "./studio";
import type { Locator, Page } from "@playwright/test";

const MODULE = "/content/lists.val.ts";

/** Reach the compare view the way an editor does — see compare.spec.ts. */
async function openCompare(page: Page, studio: Locator): Promise<void> {
  const review = studio.getByRole("button", { name: /Review \d+ change/ });
  await expect(review).toBeVisible({ timeout: 30000 });
  await review.click();
}

/**
 * The rendered diff lines, as text, for whichever list is on screen.
 *
 * Waits for the first line, because the compare view computes its patch sets in a
 * worker and shows "Building the comparison…" until they arrive. `allInnerTexts`
 * does not retry, so reading straight after the click returned an empty list —
 * which asserts as "the diff rendered nothing" rather than as "not yet".
 */
async function diffLines(studio: Locator): Promise<string[]> {
  const lines = studio.locator("article[data-val-studio-path] ol li");
  await expect(lines.first()).toBeVisible({ timeout: 30000 });
  return lines
    .allInnerTexts()
    .then((texts) => texts.map((line) => line.replace(/\s+/g, " ").trim()));
}

test.describe("the compare view diffs a list of primitives", () => {
  test.beforeEach(async ({ request }) => {
    await clearPatchChain(request);
  });

  /**
   * A reorder is reported as a move, and only ONE thing moved.
   *
   * The ops for a drag are a single `move` carrying `from` and `path`, but the
   * view never saw them: `PatchMetadata` keeps only the op TYPE, so the row said
   * "Moved" and showed the value with no indication of from where to where. And
   * because paths are positional, a positional before/after of the same list
   * would have called every item from the move point onwards "changed".
   */
  test("reports a reorder as a move, naming where it came from", async ({
    page,
  }) => {
    await openStudio(page, `/val/~${MODULE}?p=%22keywords%22`);
    const studio = page.locator("#val-shadow-root");
    await expect(studio.getByRole("textbox").first()).toBeVisible({
      timeout: 30000,
    });

    // Move the last item to the front, through the store, because a drag in
    // Playwright is a different test than this one.
    await patchThroughStore(page, MODULE, [
      { op: "move", from: ["keywords", "4"], path: ["keywords", "0"] },
    ]);

    await openCompare(page, studio);
    const lines = await diffLines(studio);
    console.log("MOVE lines:", JSON.stringify(lines, null, 1));

    // Exactly one line says it moved, and it names the position it came from.
    const moved = lines.filter((line) => /moved from/.test(line));
    expect(moved).toHaveLength(1);
    expect(moved[0]).toContain("validation");
    expect(moved[0]).toContain("moved from 5");
    // And nothing else is reported as changed: that is the whole claim.
    expect(lines.filter((line) => /changed/.test(line))).toEqual([]);
  });

  /**
   * An insert in the middle is one added line, and a later edit is matched
   * against the right element.
   *
   * Positionally, inserting at index 1 renamed every later index, so an edit to
   * what the editor thinks of as "the third keyword" produced a before/after of
   * two unrelated strings.
   */
  test("an insert plus an edit stays one insert plus one edit", async ({
    page,
  }) => {
    await openStudio(page, `/val/~${MODULE}?p=%22keywords%22`);
    const studio = page.locator("#val-shadow-root");
    await expect(studio.getByRole("textbox").first()).toBeVisible({
      timeout: 30000,
    });

    await patchThroughStore(page, MODULE, [
      { op: "add", path: ["keywords", "1"], value: "inserted" },
    ]);
    // "publish" is now at index 4, having been at 3. Editing it is the case that
    // used to show its "before" as whatever else was at index 4.
    await patchThroughStore(page, MODULE, [
      { op: "replace", path: ["keywords", "4"], value: "publishing" },
    ]);

    await openCompare(page, studio);
    const lines = await diffLines(studio);
    console.log("INSERT lines:", JSON.stringify(lines, null, 1));

    const added = lines.filter((line) => /\badded\b/.test(line));
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("inserted");

    // One change, and its before is the element that really did change.
    const changed = lines.filter((line) => /\bchanged\b/.test(line));
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("publish");
    expect(changed[0]).toContain("publishing");
  });

  /** A deletion says removed, in the place the item used to be. */
  test("reports a deletion where it was", async ({ page }) => {
    await openStudio(page, `/val/~${MODULE}?p=%22keywords%22`);
    const studio = page.locator("#val-shadow-root");
    await expect(studio.getByRole("textbox").first()).toBeVisible({
      timeout: 30000,
    });

    await patchThroughStore(page, MODULE, [
      { op: "remove", path: ["keywords", "2"] },
    ]);

    await openCompare(page, studio);
    const lines = await diffLines(studio);
    console.log("REMOVE lines:", JSON.stringify(lines, null, 1));

    const removed = lines.filter((line) => /\bremoved\b/.test(line));
    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain("preview");
    // Where it was, said in the tag rather than in the gutter: a removed line has
    // no position in the list you end up with, and printing its old index there
    // collided with the line that now occupies the slot.
    expect(removed[0]).toContain("removed from 3");
    expect(lines.filter((line) => /changed/.test(line))).toEqual([]);

    // No two lines claim the same position in the resulting list.
    const positions = lines
      .filter((line) => !/removed/.test(line))
      .map((line) => line.split(" ")[0]);
    expect(new Set(positions).size).toBe(positions.length);
  });
});
