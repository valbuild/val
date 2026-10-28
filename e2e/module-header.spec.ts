import { expect } from "@playwright/test";
import { openStudio, test } from "./studio";

/**
 * The module header, as a way back.
 *
 * Under the heading is one link, `‹ <parent>` (labelled "Back to <parent>"),
 * where the parent is wherever the level above is shown and its name is its
 * title. It was a
 * breadcrumb of path segments, every one of which between a page and a field
 * of it opened the same page.
 *
 * A FIELD inside a page is the case that motivated it — see `A page names
 * itself and nothing else` below for why the page itself has no way back.
 *
 * The generic page: a page with NO preview, so its heading is its route. That
 * is the case every `toHaveText("/generic")` below pins -- a page that has a
 * preview (the showcase's home, "Content as code") is titled by it instead,
 * which is a different rule. `sections` is a field inside it, as `hero` was
 * on the Next example's home page this spec used to drive.
 */
const FIELD_IN_PAGE =
  "/val/~/src/routes/_site.generic.$.val.ts?p=%22%2Fgeneric%22.sections";
const PAGE = "/val/~/src/routes/_site.generic.$.val.ts?p=%22%2Fgeneric%22";
const ROUTE = "/generic";

test.describe("the module header", () => {
  test("names the field, and offers one way back", async ({ page }) => {
    await openStudio(page, FIELD_IN_PAGE);

    // The title leads; the way back sits under it, as one link.
    const back = page.getByRole("navigation", { name: "Back" });
    await expect(back).toBeVisible();
    await expect(back.getByRole("link")).toHaveCount(1);

    // An anchor with a real destination, so it can be copied and
    // middle-clicked rather than only clicked.
    const href = await back.getByRole("link").getAttribute("href");
    expect(href, "a way back with no destination").toBeTruthy();
    expect(href).toContain("/val/~");
  });

  test("back goes to the page the field is on", async ({ page }) => {
    await openStudio(page, FIELD_IN_PAGE);

    /*
     * By role, not by label: the sticky bar carries a copy of the header,
     * hidden from the accessibility tree until the header has been scrolled
     * past — and `getByLabel` would find that copy first.
     *
     * Named by the page's title: the page has no preview, so that is its
     * route.
     */
    const back = page.getByRole("link", { name: `Back to ${ROUTE}` });
    await expect(back).toBeVisible();

    await back.click();
    /*
     * Back from a field of a page is that page, not the router. Asked of the
     * heading rather than the text, because the sticky bar carries a hidden
     * copy of the same title.
     */
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ROUTE);
  });

  /**
   * The heading is smaller when the editor is sharing the screen.
   *
   * Beside the canvas the editor is one of three panes that begin on the same
   * line, and the other two are using their space by then: the preview's
   * address bar is a control you type in, the On page header is a count and a
   * filter. A 24px title with 124px of chrome around it reads as a pane that
   * has not loaded yet rather than as a heading with presence.
   *
   * Measured as a RELATIONSHIP rather than against a number: what must hold is
   * that the heading gives way when the page is beside it and does not when the
   * editor is alone, and a pixel count here would fail every time either size
   * is tuned.
   */
  test("the heading gives way to the canvas, and only to the canvas", async ({
    page,
  }) => {
    const headingBox = async () => {
      const box = await page
        .getByRole("heading", { level: 1 })
        .first()
        .boundingBox();
      if (box === null) {
        throw new Error("expected the heading to be laid out");
      }
      return box;
    };

    await openStudio(page, PAGE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ROUTE);
    const alone = await headingBox();

    await openStudio(page, `${PAGE}&canvas=1`);
    await expect(
      page.getByRole("button", { name: "Fit page width" }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ROUTE);
    const besideTheCanvas = await headingBox();

    expect(besideTheCanvas.height).toBeLessThan(alone.height);
  });

  test("a page names itself and nothing else", async ({ page }) => {
    await openStudio(page, PAGE);

    /*
     * A page's location is its ROUTE, and the route is already the complete
     * path — so the four segments that used to precede it
     * (`App / … / Page / Pages / …`) said where the module is STORED, which is
     * not how anyone reaches a page: the Pages panel is a tree of routes. So
     * the file is not the page's parent, and "Back to Pages" would duplicate
     * that same panel.
     */
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ROUTE);
    await expect(page.getByRole("navigation", { name: "Back" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Back to/ })).toHaveCount(0);
  });
});
