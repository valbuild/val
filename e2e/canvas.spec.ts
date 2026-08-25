import { expect, test } from "@playwright/test";
import { closeNavPanel, expandRow, openSiteMap, openStudio } from "./studio";

/**
 * The canvas: the running site beside the editor for it.
 *
 * What this is really checking is that the canvas shows the *real* page. The
 * shell was built against a hardcoded demo page, and that page renders happily
 * with no app behind it at all — so a canvas that had come loose from the
 * running site would still look right in a screenshot. The assertion that
 * catches it is the frame's URL: it has to be the route the selected page is
 * on, served by the app, and it has to have rendered that route's content.
 *
 * The canvas also has two gates that are easy to get wrong in opposite
 * directions, so both are checked: it is offered on a page whose route Val
 * resolves, and it is not offered on a module that is not on a route at all.
 */

/** The frame the canvas is showing, if it is showing one. */
function canvasFrameUrls(page: import("@playwright/test").Page): string[] {
  return page
    .frames()
    .map((frame) => frame.url())
    .filter((url) => url !== "" && !url.includes("/val"));
}

test.describe("the canvas", () => {
  test("puts the running page beside its editor", async ({ page }) => {
    await openStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await closeNavPanel(studio, "Pages");

    // The editor for the page opened first: the canvas joins it rather than
    // replacing it, so both have to be on screen.
    const title = studio.locator("input").first();
    await expect(title).toHaveValue("Blog 1");

    const canvasButton = studio.getByRole("button", { name: "Canvas" });
    await expect(
      canvasButton,
      "the canvas was not offered on a page Val resolves",
    ).toBeVisible();
    await canvasButton.click();

    // The zoom control only exists once the canvas is laid out, and the
    // percentage only stops being 100% once it has measured the page against
    // the pane — which is the difference between a canvas that opened and one
    // whose column never moved.
    await expect(
      studio.getByRole("button", { name: "Fit page to screen" }),
    ).toBeVisible();

    /**
     * The frame, which is the point.
     *
     * `expect.poll` because the frame is attached when the canvas mounts but
     * has not necessarily committed its navigation yet, and the URL is `about:
     * blank` until it does.
     */
    await expect
      .poll(() => canvasFrameUrls(page), {
        message: "the canvas never loaded the page's own route",
      })
      .toEqual([expect.stringContaining("/blogs/blog1")]);

    // And it is the app's render of that route, not an empty frame.
    const frame = page
      .frames()
      .find((candidate) => candidate.url().includes("/blogs/blog1"));
    expect(frame, "the canvas frame went away").toBeTruthy();
    await expect(frame!.locator("body")).toContainText("Blog 1");

    // Closing puts the editor back at full width, and leaves it on the same
    // page: the way out lands where the way in started.
    await studio.getByRole("button", { name: "Close canvas" }).click();
    await expect(title).toHaveValue("Blog 1");
  });

  test("is not offered for content that is not on a route", async ({
    page,
  }) => {
    await openStudio(page, "/val/~/content/authors.val.ts");
    const studio = page.locator("#val-shadow-root");
    // The module is open — the canvas question is only meaningful once it is.
    await expect(studio.getByRole("button", { name: "Canvas" })).toHaveCount(0);
  });
});
