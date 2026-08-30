import { expect, test } from "@playwright/test";
import { openStudio } from "./studio";

/**
 * The phone's canvas layout.
 *
 * Two things were wrong and both are measured rather than eyeballed, because
 * both are "how much space" questions that a screenshot review passes.
 */
const HOME = "/val/~/app/page.val.ts?p=%22%2F%22";

test.use({ viewport: { width: 390, height: 844 } });

test.describe("the canvas on a phone", () => {
  test("starts the editor column directly below the switches", async ({
    page,
  }) => {
    await openStudio(page, `${HOME}&canvas=1`);

    const strip = page.getByRole("tablist", { name: "Workspace pane" });
    await expect(strip).toBeVisible();
    const stripBox = await strip.boundingBox();
    // The scroller, not the first field: what is measured here is the empty
    // space the LAYOUT adds, and how tall the module's own header happens to be
    // is a separate question (and a separate task).
    const column = page.locator("#val-content-area");
    const columnBox = await column.boundingBox();
    if (stripBox === null || columnBox === null) {
      throw new Error("expected the strip and the column to be laid out");
    }

    /**
     * The pane already reserves room for the top bar AND this strip, so the
     * column's own top padding is pure duplication — 80px of it, which put the
     * switches in the middle of an empty band instead of just above the
     * content.
     */
    const gap = columnBox.y - (stripBox.y + stripBox.height);
    expect(gap).toBeLessThan(24);
    expect(gap).toBeGreaterThan(-2);

    // And the padding inside it is a hairline, not a second clearance.
    const paddingTop = await column.evaluate((node) =>
      parseFloat(
        getComputedStyle(node.firstElementChild as HTMLElement).paddingTop,
      ),
    );
    expect(paddingTop).toBeLessThan(16);
  });

  test("puts the pane switch on the right of the strip", async ({ page }) => {
    await openStudio(page, `${HOME}&canvas=1`);

    const pane = page.getByRole("tablist", { name: "Workspace pane" });
    await expect(pane).toBeVisible();
    const paneBox = await pane.boundingBox();
    const viewport = page.viewportSize();
    if (paneBox === null || viewport === null) {
      throw new Error("expected the pane switch to be laid out");
    }

    /**
     * Which pane you are LOOKING at goes right; what that pane HOLDS goes left.
     * The two were the other way round, which read backwards against the
     * desktop layout — where the view switch sits at the top of the column it
     * changes and the canvas is the thing off to the right.
     *
     * Checked as "the pane switch is right-aligned" rather than by comparing the
     * two switches, because the view switch is only there once the page has
     * reported what is on it: on a phone that can take a while, and a test that
     * waits for it is a test about the canvas, not about this row.
     */
    expect(paneBox.x).toBeGreaterThan(viewport.width / 2);
    expect(paneBox.x + paneBox.width).toBeGreaterThan(viewport.width - 24);
  });

  /**
   * Picking something on the page, which is what the canvas is for.
   *
   * The reported failure: tapping a field showed neither pane properly. The
   * workspace came to rest between the editor and the canvas — half of each on
   * screen — and stayed there; selecting a different page did not recover it,
   * because nothing in the studio ever re-asserted where the panes were.
   *
   * It got there because a pane is a scroll position, and the canvas pane holds
   * an iframe on the customer's site. Clicking inside a frame focuses it and the
   * browser scrolls ancestors to reveal it; the studio then asked the page to
   * scroll the picked field into view, and `scrollIntoView` in a same-origin
   * frame scrolls the EMBEDDER's containers too. Both reveal an element rather
   * than a pane, so they leave the scroller anywhere.
   *
   * Three things changed and any one of them alone would leave a race: the page
   * no longer scrolls anything outside itself, the studio no longer asks it to
   * scroll to a field that was just clicked, and the pane scroller puts itself
   * back on a pane whenever it comes to rest anywhere else. What is asserted
   * here is the outcome all three exist for, in a real browser with a real
   * frame — because that is the only place the interaction exists at all.
   */
  test("a pick on the page lands on the fields column, whole", async ({
    page,
  }) => {
    await openStudio(page, `${HOME}&canvas=1`);

    /**
     * Preview mode first: a fresh browser has neither the Val Enable cookie nor
     * draft mode, so the page mounts none of Val's client code, tags nothing,
     * and there is nothing on it to pick.
     */
    const enable = page.getByRole("button", { name: /Turn on preview mode/ });
    await expect(enable).toBeVisible({ timeout: 25_000 });
    await enable.click();

    // The switch appears once the page has reported what is on it, which is
    // also when picking becomes possible. It lives on the editor pane.
    const paneSwitch = page.getByRole("tablist", { name: "Workspace pane" });
    await paneSwitch.getByRole("tab", { name: "Editor" }).click();
    const fieldsTab = page.getByRole("tab", { name: /Fields/ });
    await expect(
      fieldsTab,
      "the page never reported any content, so preview mode did not take",
    ).toBeVisible({ timeout: 30_000 });
    await fieldsTab.click();

    const fields = page.getByRole("heading", { name: "On this page" });
    await expect(fields).toBeVisible();

    // Go and look at the page, as anyone about to point at something would.
    await paneSwitch.getByRole("tab", { name: "Canvas" }).click();
    const frame = page
      .frames()
      .find((candidate) => candidate.url().includes("val_canvas"));
    expect(frame, "the canvas never loaded the page").toBeTruthy();

    /**
     * Something well inside the pane.
     *
     * Not simply the first tagged element: the studio floats its route bar and
     * its exit button over the top of the canvas pane and its toolbar over the
     * bottom, and those are in the PARENT document — which the frame's own hit
     * testing cannot see. A click aimed at an element under one of them is
     * reported as landing on the element and is actually taken by the overlay,
     * so the pick never happens and the test fails for a reason that has
     * nothing to do with the pick.
     */
    const tagged = frame!.locator("[data-val-path]");
    const count = await tagged.count();
    let target = -1;
    for (let index = 0; index < count; index++) {
      const box = await tagged.nth(index).boundingBox();
      if (box === null) continue;
      if (box.y > 220 && box.y + box.height < 700 && box.width > 20) {
        target = index;
        break;
      }
    }
    expect(
      target,
      "nothing on the page was clear of the studio's own controls",
    ).toBeGreaterThanOrEqual(0);
    await tagged.nth(target).click();

    /**
     * Back on the fields column — and all of it on screen.
     *
     * The width check is the whole point. "Is the fields column visible" passes
     * with the panes split down the middle, which is exactly the state being
     * ruled out, so what is measured is that the column occupies the viewport
     * rather than half of it.
     */
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    const wholeOnScreen = async () => {
      const box = await fields.boundingBox();
      if (box === null || viewport === null) return null;
      return box.x >= -1 && box.x + box.width <= viewport.width + 1;
    };
    await expect
      .poll(wholeOnScreen, {
        message: "the workspace came to rest between the editor and the canvas",
      })
      .toBe(true);

    /*
     * And it stays there. Everything that used to undo it arrives AFTER the
     * pick: the browser revealing the frame the click focused, the page's own
     * highlight scroll, and the fields column re-laying itself out as each
     * schema resolves.
     */
    await page.waitForTimeout(2000);
    expect(await wholeOnScreen()).toBe(true);

    // And the canvas is still open. A field on the page belongs to the page
    // whichever module it lives in, so picking one is never a reason to leave.
    await expect(paneSwitch).toBeVisible();
  });

  /**
   * The invariant, forced rather than raced.
   *
   * The test above asserts the outcome of a pick; it cannot make the failure
   * happen on demand, because the failure was a race — something outside the
   * studio moved the pane scroller, and whether it won depended on how busy the
   * phone was. Desktop Chromium driving a 390px viewport is not a busy phone, so
   * that test passes with or without the fix.
   *
   * This one removes the race. It does the thing the page used to do, at a
   * moment of its choosing: a `scrollIntoView` inside the frame, which walks out
   * of the frame and scrolls the studio's own containers. Reveal an ELEMENT
   * inside the canvas pane and the scroller ends up wherever that element
   * happened to need — which is the split view the report described.
   *
   * What is asserted is that it does not stay there. Nothing in the studio has
   * to know which browser behaviour did it, or be quicker than it: the panes are
   * put back on a pane whenever they come to rest anywhere else.
   */
  test("puts itself back when something outside scrolls the panes", async ({
    page,
  }) => {
    await openStudio(page, `${HOME}&canvas=1`);
    const enable = page.getByRole("button", { name: /Turn on preview mode/ });
    await expect(enable).toBeVisible({ timeout: 25_000 });
    await enable.click();

    const paneSwitch = page.getByRole("tablist", { name: "Workspace pane" });
    await paneSwitch.getByRole("tab", { name: "Editor" }).click();
    const fieldsTab = page.getByRole("tab", { name: /Fields/ });
    await expect(fieldsTab).toBeVisible({ timeout: 30_000 });
    await fieldsTab.click();
    const fields = page.getByRole("heading", { name: "On this page" });
    await expect(fields).toBeVisible();

    const frame = page
      .frames()
      .find((candidate) => candidate.url().includes("val_canvas"));
    expect(frame, "the canvas never loaded the page").toBeTruthy();

    /*
     * The page, doing what the page used to do — on its LAST tagged element, so
     * the scroll has real work to do. `scrollIntoView` on something already in
     * view moves nothing, and a test that reveals what is already revealed
     * asserts nothing.
     */
    const moved = await frame!.evaluate(() => {
      const tagged = document.querySelectorAll("[data-val-path]");
      const target = tagged[tagged.length - 1];
      if (target === undefined) return null;
      const before = window.scrollY;
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      return before;
    });
    expect(moved, "the page reported nothing to scroll to").not.toBeNull();
    await expect
      .poll(() => frame!.evaluate(() => window.scrollY), {
        message: "the page's own scroll never moved, so nothing was tested",
      })
      .not.toBe(moved);

    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    await expect
      .poll(
        async () => {
          const box = await fields.boundingBox();
          if (box === null || viewport === null) return null;
          return box.x >= -1 && box.x + box.width <= viewport.width + 1;
        },
        {
          message: "the panes were left where the page's scroll put them",
        },
      )
      .toBe(true);
  });
});
