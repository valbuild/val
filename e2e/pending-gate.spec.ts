import { expect, test, type Locator } from "@playwright/test";
import { clearPatchChain, openStudio } from "./studio";

/**
 * The fields are held until the server's pending changes have landed.
 *
 * Driven with a DELAYED `/patches` response, because the window this is about is
 * a few hundred milliseconds on a local server and is exactly where the bug
 * lives: a field showing published content while the change to it is in flight
 * reads as a stale value, so an editor fixes it — and the real value lands
 * underneath the fix.
 */
const HOME = "/val/~/app/page.val.ts?p=%22%2F%22";

/**
 * Whether this element has focus.
 *
 * Asked of the element's own root: the studio renders inside a shadow DOM, so
 * `document.activeElement` is the host and never the field.
 */
async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => {
    const root = node.getRootNode();
    return root instanceof ShadowRoot
      ? root.activeElement === node
      : document.activeElement === node;
  });
}

test.describe("the pending-changes gate", () => {
  test.beforeEach(async ({ request }) => {
    await clearPatchChain(request);
  });

  test("holds the fields, says so, then releases them", async ({ page }) => {
    // A patch to wait for, made through the API so the studio finds it on load.
    await openStudio(page, HOME);
    const title = page.locator("input").first();
    await expect(title).toHaveValue("Content as code");
    await title.fill("Edited before reload");
    await expect
      .poll(async () => {
        const res = await page.request.get("/api/val/patches");
        const body = (await res.json()) as { patches: unknown[] };
        return body.patches.length;
      })
      .toBeGreaterThan(0);

    // Now reload with the patch fetch held back.
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => url.pathname.endsWith("/api/val/patches"),
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.fallback();
          return;
        }
        await held;
        await route.fallback();
      },
    );

    await page.goto(HOME);

    // The note, and the fields inert.
    await expect(page.getByText("Loading unpublished changes…")).toBeVisible({
      timeout: 15000,
    });
    const heldTitle = page.locator("input").first();
    await expect(heldTitle).toBeVisible();
    // `inert` swallows the click, so the field cannot take focus — which is the
    // point: it may be showing a value that is about to change.
    await heldTitle
      .click({ force: true, timeout: 5000 })
      .catch(() => undefined);
    expect(await isFocused(heldTitle)).toBe(false);

    release();

    await expect(page.getByText("Loading unpublished changes…")).toHaveCount(
      0,
      {
        timeout: 15000,
      },
    );
    // Released, and showing the pending change rather than the published value.
    await expect(page.locator("input").first()).toHaveValue(
      "Edited before reload",
    );
    const released = page.locator("input").first();
    await released.click();
    expect(await isFocused(released)).toBe(true);
  });
});
