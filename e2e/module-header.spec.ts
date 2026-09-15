import { expect } from "@playwright/test";
import { openStudio, test } from "./studio";

/**
 * The module header, as a way back up.
 *
 * The header used to render this as plain text — a line of grey crumbs that
 * said where you were and could not take you there. From a field inside a page
 * inside a router the only ways up were the browser's back button and the Pages
 * panel, so this pins the two things that changed: the trail is real links, and
 * the arrow goes up exactly one level.
 *
 * A FIELD inside a page is the case that motivated it and the case that still
 * has a trail — see `A page names itself and nothing else` below for why the
 * page itself no longer does.
 */
const FIELD_IN_PAGE = "/val/~/app/page.val.ts?p=%22%2F%22.hero";
const PAGE = "/val/~/app/page.val.ts?p=%22%2F%22";

test.describe("the module header", () => {
  test("names the field, and links up the scope", async ({ page }) => {
    await openStudio(page, FIELD_IN_PAGE);

    // The title leads; the scope sits under it as links.
    const scope = page.getByRole("navigation", { name: "Scope" });
    await expect(scope).toBeVisible();
    const links = scope.getByRole("link");
    await expect(links.first()).toBeVisible();

    // Every segment is an anchor with a real destination, so it can be copied
    // and middle-clicked rather than only clicked.
    for (const link of await links.all()) {
      const href = await link.getAttribute("href");
      expect(href, "a scope segment with no destination").toBeTruthy();
      expect(href).toContain("/val/~");
    }
  });

  test("the arrow goes up one level", async ({ page }) => {
    await openStudio(page, FIELD_IN_PAGE);

    /*
     * By role, not by label: the sticky bar carries the same arrow, hidden from
     * the accessibility tree until the header has been scrolled past — and
     * `getByLabel` would find that copy first, since it comes first in the DOM.
     */
    const up = page.getByRole("link", { name: /^Up one level/ });
    await expect(up).toBeVisible();
    const href = await up.getAttribute("href");
    expect(href).toBeTruthy();

    await up.click();
    /*
     * Up from a field of a page is that page — one level, not back out to the
     * router. Asked of the heading rather than the text, because the sticky bar
     * carries a hidden copy of the same title.
     */
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("/");
  });

  test("a page names itself and nothing else", async ({ page }) => {
    await openStudio(page, PAGE);

    /*
     * A page's location is its ROUTE, and the route is already the complete
     * path — so the four segments that used to precede it
     * (`App / … / Page / Pages / …`) said where the module is STORED, which is
     * not how anyone reaches a page: the Pages panel is a tree of routes. With
     * the route in the heading there is nothing left for the trail to add, and
     * an arrow up to the page list would duplicate that same panel.
     */
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("/");
    await expect(page.getByRole("navigation", { name: "Scope" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: /^Up one level/ })).toHaveCount(
      0,
    );
  });
});
