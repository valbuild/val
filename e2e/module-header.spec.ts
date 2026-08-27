import { expect, test } from "@playwright/test";
import { openStudio } from "./studio";

/**
 * The module header, as a way back up.
 *
 * The header used to be plain text — a line of grey crumbs that said where you
 * were and could not take you there. From a field inside a page inside a router
 * the only ways up were the browser's back button and the Pages panel, so this
 * pins the two things that changed: the trail is real links, and the arrow goes
 * up exactly one level.
 */
const PAGE = "/val/~/app/page.val.ts?p=%22%2F%22";

test.describe("the module header", () => {
  test("names the page, and links up the scope", async ({ page }) => {
    await openStudio(page, PAGE);

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
    await openStudio(page, PAGE);

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
    // Up from a page of a router is the router itself: the list of pages.
    /*
     * Up from a page of a router is the router itself: the list of pages. Asked
     * of the heading rather than the text, because the sticky bar carries a
     * hidden copy of the same title.
     */
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pages");
  });
});
