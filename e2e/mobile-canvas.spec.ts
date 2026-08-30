import { expect, test, type Locator, type Page } from "@playwright/test";
import { openStudio } from "./studio";

/**
 * The phone's preview layout.
 *
 * A phone cannot show the editor and the page at once, so it shows one of three
 * things: the module editor (Normal), the page's own fields (Fields), or the
 * page (Preview). The switch that moves between them is one control with three
 * options, and the way out is the X beside it.
 *
 * What is worth testing here is the part a screenshot review passes: that the
 * modes are the same three states every time, that moving between them does not
 * throw the page away and load it again, and that leaving really does stop it.
 * The layout measurements are here for the same reason — "how much space"
 * questions look fine in a picture and are wrong by 80px in the DOM.
 */
const HOME = "/val/~/app/page.val.ts?p=%22%2F%22";
/**
 * A field on the home page, named in full.
 *
 * In full because the page has three whose path ends in `."text"` — the hero's
 * link text and the video's caption are the others.
 */
const TEXT_FIELD = '/app/page.val.ts?p="/"."text"';

test.use({ viewport: { width: 390, height: 844 } });

/** The three-option switch above the panes. */
function modeSwitch(page: Page): Locator {
  return page.getByRole("tablist", { name: "Workspace view" });
}

function mode(page: Page, name: "Normal" | "Fields" | "Preview"): Locator {
  return modeSwitch(page).getByRole("tab", { name, exact: false });
}

/** The running site, by the title `CanvasFrame` gives its frame. */
function canvasFrame(page: Page): Locator {
  return page.locator('iframe[title^="Preview of"]');
}

/**
 * Open the studio on the home page with the canvas already up.
 *
 * `canvas=1` rather than pressing Preview, because what these tests are about
 * is what happens once you are in this mode — and the button that gets you
 * there is the mobile bottom bar's, which has its own reasons to be slow.
 */
async function openPreview(page: Page): Promise<void> {
  await openStudio(page, `${HOME}&canvas=1`);
  await expect(modeSwitch(page)).toBeVisible();
}

test.describe("the preview modes on a phone", () => {
  test("leaves air between the switches and what is under them", async ({
    page,
  }) => {
    await openPreview(page);
    await mode(page, "Normal").click();

    const stripBox = await modeSwitch(page).boundingBox();
    // The scroller, not the first field: what is measured here is the empty
    // space the LAYOUT adds, and how tall the module's own header happens to be
    // is a separate question (and a separate task).
    const column = page.locator("#val-content-area");
    const columnBox = await column.boundingBox();
    if (stripBox === null || columnBox === null) {
      throw new Error("expected the strip and the column to be laid out");
    }

    /**
     * Enough of a gap to read as a row of its own.
     *
     * Both ends fail differently and both have shipped. Too much and the
     * switches sit in the middle of an empty band — 80px of duplicated
     * clearance, which is what the pane used to add on top of the strip's own.
     * Too little and they are stuck to the top of the content, which is what
     * replacing that duplication with nothing produced: a 2px gap.
     */
    const gap = columnBox.y - (stripBox.y + stripBox.height);
    expect(gap).toBeGreaterThan(16);
    expect(gap).toBeLessThan(48);

    // And the padding inside it is a hairline, not a second clearance.
    const paddingTop = await column.evaluate((node) =>
      parseFloat(
        getComputedStyle(node.firstElementChild as HTMLElement).paddingTop,
      ),
    );
    expect(paddingTop).toBeLessThan(16);
  });

  test("puts the way out at the far right of the strip", async ({ page }) => {
    await openPreview(page);

    const exit = page.getByRole("button", { name: "Exit Preview" });
    await expect(exit).toBeVisible();
    const exitBox = await exit.boundingBox();
    const switchBox = await modeSwitch(page).boundingBox();
    const viewport = page.viewportSize();
    if (exitBox === null || switchBox === null || viewport === null) {
      throw new Error("expected the strip to be laid out");
    }

    /**
     * Where you can GO on the left, how to LEAVE on the right.
     *
     * The right of this row used to hold a second two-state switch, whose
     * "Editor" half meant "not the page" and whose other half meant the page —
     * so the row had two controls that each changed what the other one meant.
     * The X is the only thing on the right now, and it does one thing.
     */
    expect(exitBox.x).toBeGreaterThan(switchBox.x + switchBox.width);
    expect(exitBox.x + exitBox.width).toBeGreaterThan(viewport.width - 24);

    // Same height as the switch beside it: four controls on one row, one of
    // which is a couple of pixels shorter, reads as a mistake.
    expect(Math.abs(exitBox.height - switchBox.height)).toBeLessThan(2);
  });

  /**
   * The whole point of the modes.
   *
   * Edit, look, edit again — and every hop between them has to be free. The
   * canvas is the running site in a frame, so a remount is a full page load:
   * the scroll position, the client state and any route you had navigated to
   * inside it all go. The frame is therefore tagged and the tag is looked for
   * again, because "the canvas is still on screen" is true of a reloaded one.
   */
  test("moves between the modes without reloading the page", async ({
    page,
  }) => {
    await openPreview(page);
    const frame = canvasFrame(page);
    await expect(frame).toBeVisible();
    await frame.evaluate((node) => {
      node.setAttribute("data-e2e-probe", "same-frame");
    });

    // Every hop the three modes offer, including the two that swap what the
    // left pane holds while the page sits off screen.
    const hops: ReadonlyArray<"Normal" | "Fields" | "Preview"> = [
      "Normal",
      "Fields",
      "Preview",
      "Normal",
    ];
    for (const name of hops) {
      const tab = mode(page, name);
      if ((await tab.count()) === 0) continue;
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(
        frame,
        `the canvas was thrown away and rebuilt on the way to ${name}`,
      ).toHaveAttribute("data-e2e-probe", "same-frame");
    }
  });

  /**
   * Preview, on a phone, is "take me there" and then "take me back".
   *
   * Not a toggle that closes: edit, look, edit again is the loop this screen is
   * for, and a button that tore the page down every other press made the middle
   * step cost a page load. Leaving is the X, and only the X.
   */
  test("goes to the page and back on the Preview button", async ({ page }) => {
    await openStudio(page, HOME);

    const preview = page.getByRole("tab", { name: "Preview" });
    await page.getByRole("button", { name: "Open the canvas" }).click();
    await expect(preview).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: "Back to the editor" }).click();
    await expect(preview).toHaveAttribute("aria-selected", "false");
    // The page is still there, off screen, rather than gone: that is the
    // difference between coming back and closing.
    await expect(canvasFrame(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Back to the preview" }).click();
    await expect(preview).toHaveAttribute("aria-selected", "true");
  });

  /**
   * Picking on the page is a request to edit the thing picked.
   *
   * So it has to end at the field, every time: the fields mode, on the left
   * pane, scrolled to the field that was picked. On a phone the field is on the
   * pane the page is NOT on, so a pick that only changed the view left you
   * looking at the page you had just selected on.
   */
  test("picking on the page lands on the fields", async ({ page }) => {
    await openPreview(page);

    // A fresh browser has no preview cookie, so the page mounts none of Val's
    // client code and reports nothing to pick.
    const enable = page.getByRole("button", { name: /Turn on preview mode/ });
    await expect(enable).toBeVisible({ timeout: 30_000 });
    await enable.click();
    const fields = mode(page, "Fields");
    await expect(fields).toBeVisible({ timeout: 30_000 });

    // Fields arms picking; Preview then puts the page in front of you with it
    // still armed, which is the state a pick happens in.
    await fields.click();
    await mode(page, "Preview").click();
    await expect(
      page.getByRole("button", { name: "Stop selecting on the page" }),
    ).toBeVisible();

    const target = page
      .frameLocator('iframe[title^="Preview of"]')
      .locator(`[data-val-path='${TEXT_FIELD}']`);
    await expect(target).toBeVisible();
    await target.click({ force: true });

    // The field is open in the editor...
    await expect
      .poll(() => decodeURIComponent(page.url()), {
        message: "picking on the page did not open the field it belongs to",
      })
      .toContain('."text"');
    // ...and the phone is looking at the fields, not still at the page.
    await expect(mode(page, "Fields")).toHaveAttribute("aria-selected", "true");
    await expect(mode(page, "Preview")).toHaveAttribute(
      "aria-selected",
      "false",
    );
    // Scrolled to it, rather than listing it somewhere below the fold.
    const row = page.locator(`[data-canvas-field='${TEXT_FIELD}']`);
    await expect(row).toBeInViewport();
  });

  test("stops the page when you exit", async ({ page }) => {
    await openPreview(page);
    await expect(canvasFrame(page)).toBeVisible();

    await page.getByRole("button", { name: "Exit Preview" }).click();

    // Not merely hidden: a closed canvas that is still mounted is a second copy
    // of the site running in this tab.
    await expect(canvasFrame(page)).toHaveCount(0);
    await expect(modeSwitch(page)).toHaveCount(0);
    // And the editor is back, at the page it was on.
    await expect(page.locator("#val-content-area")).toBeVisible();
  });
  /**
   * The state the phone kept getting stuck in, forced rather than raced.
   *
   * The reported failure was that tapping a field showed neither pane properly:
   * the workspace came to rest between the editor and the page — half of each on
   * screen — and stayed there. Selecting a different page did not recover it;
   * only closing the canvas did.
   *
   * It got there because a pane was a scroll position, and the canvas pane holds
   * a same-origin frame. `scrollIntoView` inside such a frame walks out of it and
   * scrolls the embedder's containers, and it reveals an ELEMENT rather than a
   * pane, so it leaves the scroller anywhere. A pick made it happen for real,
   * but only on a phone busy enough to lose the race — desktop Chromium driving a
   * 390px viewport is not, so asserting on a pick alone proves little either way.
   *
   * So this does the thing the page used to do, at a moment of its choosing. What
   * is asserted is that it changes nothing: there is no scroll offset to write
   * to any more — see `overflow-clip` in `PageWorkspace` — so nothing has to be
   * quicker than the browser, or know which browser behaviour did it.
   */
  test("cannot be left between modes by a scroll inside the page", async ({
    page,
  }) => {
    await openPreview(page);
    const enable = page.getByRole("button", { name: /Turn on preview mode/ });
    await expect(enable).toBeVisible({ timeout: 30_000 });
    await enable.click();
    await expect(mode(page, "Fields")).toBeVisible({ timeout: 30_000 });
    await mode(page, "Fields").click();

    const fields = page.getByRole("heading", { name: "On this page" });
    await expect(fields).toBeVisible();

    const frame = page
      .frames()
      .find((candidate) => candidate.url().includes("val_canvas"));
    expect(frame, "the canvas never loaded the page").toBeTruthy();

    /*
     * On the page's LAST tagged element, so the scroll has real work to do.
     * `scrollIntoView` on something already in view moves nothing, and a test
     * that reveals what is already revealed asserts nothing.
     */
    const before = await frame!.evaluate(() => {
      const tagged = document.querySelectorAll("[data-val-path]");
      const target = tagged[tagged.length - 1];
      if (target === undefined) return null;
      const scrollY = window.scrollY;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      return scrollY;
    });
    expect(before, "the page reported nothing to scroll to").not.toBeNull();
    await expect
      .poll(() => frame!.evaluate(() => window.scrollY), {
        message: "the page's own scroll never moved, so nothing was tested",
      })
      .not.toBe(before);

    /**
     * The fields column, whole.
     *
     * The width check is the point. "Is the fields column visible" passes with
     * the two modes split down the middle, which is exactly the state being
     * ruled out — so what is measured is that it occupies the viewport rather
     * than half of it.
     */
    const viewport = page.viewportSize();
    const wholeOnScreen = async () => {
      const box = await fields.boundingBox();
      if (box === null || viewport === null) return null;
      return box.x >= -1 && box.x + box.width <= viewport.width + 1;
    };
    await expect
      .poll(wholeOnScreen, {
        message: "the page's scroll left the workspace between two modes",
      })
      .toBe(true);
    // And it stays: the smooth scroll above is still arriving.
    await page.waitForTimeout(2000);
    expect(await wholeOnScreen()).toBe(true);
  });
});
