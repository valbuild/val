import { expect, type Page } from "@playwright/test";
import { openStudio, test } from "../studio";

/**
 * The editor scrolls under the wheel while a nav panel is open beside it.
 *
 * A panel closes on a click outside it, and that used to be done by an
 * invisible scrim the size of the screen. It caught every wheel event over the
 * editor as well, and having nothing to scroll, it froze the page: open Pages
 * to look for something and the content next to it could not be scrolled.
 * The scrim now lets the pointer through (`useClickOutside` in
 * `FloatingPanel`), and these pin both halves of that: the wheel reaches the
 * editor, and a click still closes the panel where it did before, and only
 * there.
 */

// Short, so the fixture module is longer than the editor and has to scroll.
test.use({ viewport: { width: 1440, height: 600 } });

/** Over the editor, clear of the panel on the left. */
const EDITOR = { x: 900, y: 450 };

/** A destination's button on the left rail, and nothing else named like it. */
function railButton(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name, exact: true });
}

/** How far the Studio's scrollers have scrolled, together. */
function scrolled(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.querySelector("#val-shadow-root")?.shadowRoot;
    if (!root) return 0;
    let total = 0;
    root.querySelectorAll(".overflow-y-auto").forEach((el) => {
      total += el.scrollTop;
    });
    return total;
  });
}

for (const panel of ["Pages", "Media", "Data"]) {
  test(`the editor scrolls with ${panel} open, and a click on it closes ${panel}`, async ({
    page,
  }) => {
    await openStudio(page, "/val/~/content/mediaFields.val.ts");
    await railButton(page, panel).click();
    const dialog = page.getByRole("dialog", { name: panel });
    await expect(dialog).toBeVisible();

    const before = await scrolled(page);
    await page.mouse.move(EDITOR.x, EDITOR.y);
    await page.mouse.wheel(0, 500);
    await expect
      .poll(() => scrolled(page), {
        message: `the wheel over the editor did not scroll it with ${panel} open`,
      })
      .toBeGreaterThan(before);
    await expect(dialog, "scrolling closed the panel").toBeVisible();

    // The status bar is above where the scrim is: a click there is not one
    // outside the panel, as it never was.
    await page.getByText("Dev mode").click();
    await expect(dialog).toBeVisible();

    await page.mouse.click(EDITOR.x, EDITOR.y);
    await expect(dialog, "a click on the editor did not close it").toHaveCount(
      0,
    );
  });
}

test("the rail's button closes the panel it opened, rather than reopening it", async ({
  page,
}) => {
  await openStudio(page, "/val/~/content/mediaFields.val.ts");
  const pages = railButton(page, "Pages");
  await pages.click();
  await expect(page.getByRole("dialog", { name: "Pages" })).toBeVisible();
  await pages.click();
  await expect(page.getByRole("dialog", { name: "Pages" })).toHaveCount(0);
});

/**
 * A click in the canvas's preview closes the panel, as it did when the scrim
 * caught it. The preview is an iframe, so the click never reaches the
 * Studio's window; the focus moving into it does.
 */
test("a click in the canvas's preview closes the panel", async ({ page }) => {
  await openStudio(
    page,
    `/val/~/src/routes/_site.showcase.val.ts?p=${encodeURIComponent('"/showcase"')}&canvas=1`,
  );
  const frame = page.locator("iframe").first();
  await expect(frame).toBeVisible({ timeout: 60_000 });
  await railButton(page, "Pages").click();
  const dialog = page.getByRole("dialog", { name: "Pages" });
  await expect(dialog).toBeVisible();
  const box = await frame.boundingBox();
  if (!box) throw new Error("the preview has no box");
  await page.mouse.click(box.x + box.width - 60, box.y + box.height / 2);
  await expect(dialog, "a click in the preview did not close it").toHaveCount(
    0,
  );
});
