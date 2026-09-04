import { expect, test } from "@playwright/test";

/**
 * The overlay's select mode, on the customer's own page.
 *
 * Not the canvas: this is Val mounted in the host app, where the page is the
 * real page and the only thing between a click and it is the overlay. Select
 * mode works by drawing a box over whatever Val content the pointer is on and
 * catching the click on that box — so the box is not decoration, it is the
 * intercept. Anywhere it is, the page underneath has stopped responding.
 *
 * Which is why where it *is not* has to be asserted. The box used to be written
 * only when the pointer found tagged content, so it stayed over the last thing
 * the pointer crossed and quietly ate every click in that rectangle — a link
 * there could not be followed, with a green outline as the only clue.
 *
 * There is no unit test for this. jsdom has no layout and no
 * `elementsFromPoint`, and the whole behaviour is "what is on top at these
 * coordinates".
 */

/**
 * The host app's home page, which has Val content and a link in it.
 *
 * Absolute, because `redirect_to` is handed to a `Location` header rather than
 * resolved against the request — the same reason `uncommitted-routes.spec.ts`
 * spells the origin out.
 */
const HOME = "http://localhost:3456/";

/**
 * Turn preview mode on and land on the page, in one navigation.
 *
 * `/api/val/enable` sets the Val Enable cookie *and* draft mode, then redirects
 * — and both are needed before the page mounts any of Val's client code.
 */
async function openInPreviewMode(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto(`/api/val/enable?redirect_to=${encodeURIComponent(HOME)}`);
  // Next's dev-tools badge floats over the page and intercepts pointer events.
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const host = document.querySelector("#val-shadow-root");
          return !!host?.shadowRoot?.querySelector("#val-overlay-container");
        }),
      { timeout: 60_000, message: "the overlay never mounted on the page" },
    )
    .toBe(true);
}

/**
 * Whether the Val overlay is what a click at this point would hit.
 *
 * Read from the host document, which is the only place it can be read from: the
 * box lives in a shadow root, so `elementsFromPoint` reports its host element
 * rather than the box itself. The host being on top *is* the intercept.
 */
async function overlayCovers(
  page: import("@playwright/test").Page,
  point: { x: number; y: number },
): Promise<boolean> {
  return page.evaluate(
    ({ x, y }) => document.elementsFromPoint(x, y)[0]?.id === "val-shadow-root",
    point,
  );
}

test.describe("the overlay's select mode", () => {
  test("stops covering the page once the pointer leaves Val content", async ({
    page,
  }) => {
    await openInPreviewMode(page);

    // The select-mode toggle, by its icon: the menu buttons carry tooltips
    // rather than labels, and the tooltip is in a hover card that is not open.
    const armed = await page.evaluate(() => {
      const root = (
        document.querySelector("#val-shadow-root") as HTMLElement | null
      )?.shadowRoot;
      const button = root
        ? [...root.querySelectorAll("button")].find((candidate) =>
            candidate.querySelector("svg.lucide-square-dashed-mouse-pointer"),
          )
        : undefined;
      if (!button) return false;
      button.click();
      return true;
    });
    expect(armed, "the select-mode toggle was not on the menu").toBe(true);

    const tagged = page.locator("main a[data-val-path]").first();
    await expect(
      tagged,
      "the page rendered no tagged content to select",
    ).toBeVisible();
    const box = await tagged.boundingBox();
    expect(box, "the tagged element has no box to point at").toBeTruthy();
    const centre = {
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
    };

    // On the content: the overlay takes the click, which is the point of the
    // mode. Asserted so this test cannot pass by select mode never arming.
    await page.mouse.move(centre.x, centre.y);
    await expect
      .poll(() => overlayCovers(page, centre), {
        message: "select mode did not put the overlay over Val content",
      })
      .toBe(true);

    // Off it, onto page background with nothing tagged under it: the overlay
    // has to let go. This is the assertion the bug failed.
    await page.mouse.move(4, 4);
    await expect
      .poll(() => overlayCovers(page, centre), {
        message:
          "the selection box stayed over the content the pointer had left, so clicks there still could not reach the page",
      })
      .toBe(false);
  });
});
