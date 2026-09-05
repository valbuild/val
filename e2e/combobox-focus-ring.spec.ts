import { expect } from "@playwright/test";
import { openStudio, test } from "./studio";

/**
 * The focus ring on a combobox's search field.
 *
 * A ring is a `box-shadow` spread, so it is only ever drawn around the element
 * that carries it - and the search INPUT is not the search field the user sees.
 * It starts after the magnifier icon and stops short of the row's padding, so a
 * ring on it is a rectangle floating inside the popover with a gap down each
 * side. The ring belongs on the row, which is the box.
 *
 * Only a browser can answer this: the ring is a computed `box-shadow` behind a
 * `:has(:focus-visible)` selector, and jsdom has neither. So the test reads the
 * painted shadow and the two boxes rather than the class list - a class name
 * assertion would pass just as happily with the ring on the wrong element.
 */
const POST = "/val/~/app/blogs/[blog]/page.val.ts?p=%22%2Fblogs%2Fblog1%22";

/** The green in `--border-focus`, as Chromium reports it. */
const FOCUS_RING = "rgb(71, 205, 137) 0px 0px 0px 2px inset";

test.describe("the combobox search field's focus ring", () => {
  test("is drawn on the row, edge to edge, and not on the input inside it", async ({
    page,
  }) => {
    await openStudio(page, POST);
    const studio = page.locator("#val-shadow-root");
    const combo = studio
      .locator(`[data-val-studio-path*='"author"']`)
      .getByRole("combobox");
    await expect(combo, "the author field never rendered").toHaveCount(1, {
      timeout: 30000,
    });
    await combo.scrollIntoViewIfNeeded();
    await combo.click();

    const search = studio.getByPlaceholder("Search key...");
    await expect(search).toHaveCount(1, { timeout: 15000 });
    await search.click();
    // A text field matches `:focus-visible` whenever it is focused, but only
    // once the page has seen a keypress at all - so type one.
    await page.keyboard.press("a");

    const measured = await page.evaluate(() => {
      const sr = document.getElementById("val-shadow-root")?.shadowRoot;
      const row = sr?.querySelector("[cmdk-input-wrapper]");
      if (!(row instanceof HTMLElement)) return null;
      const input = row.querySelector("input");
      const box = row.parentElement?.parentElement;
      if (!(input instanceof HTMLElement) || !(box instanceof HTMLElement)) {
        return null;
      }
      const edges = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      };
      return {
        box: edges(box),
        row: edges(row),
        input: edges(input),
        rowShadow: getComputedStyle(row).boxShadow,
        inputShadow: getComputedStyle(input).boxShadow,
        // The top corners follow the box's own radius, so the ring does not cut
        // across a rounded corner.
        rowRadius: getComputedStyle(row).borderTopLeftRadius,
      };
    });
    expect(measured, "the search row never rendered").not.toBeNull();
    if (measured === null) return;

    expect(
      measured.rowShadow,
      "the ring is not painted on the search row",
    ).toContain(FOCUS_RING);
    expect(
      measured.inputShadow,
      "the ring is still on the input, which is narrower than the box",
    ).toBe("none");

    // The row reaches both edges of the box, give or take its 1px border. The
    // input does not, which is the whole point - so assert the gap it leaves is
    // real, or this test would pass on a layout where the two coincide and
    // prove nothing.
    expect(measured.row.left - measured.box.left).toBeLessThanOrEqual(1);
    expect(measured.box.right - measured.row.right).toBeLessThanOrEqual(1);
    expect(
      measured.input.left - measured.box.left,
      "the input is expected to be inset from the box - if it is not, this test no longer proves anything",
    ).toBeGreaterThan(8);

    expect(measured.rowRadius).not.toBe("0px");
  });
});
