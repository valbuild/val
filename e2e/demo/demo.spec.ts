import { expect, test, type Page } from "@playwright/test";

/**
 * The demo: the real Studio, with Val's server running in the tab.
 *
 * What these protect is the promise the demo makes -- edit anything, and
 * nothing leaves the tab -- so every test fails a request to `/api/val` that
 * is not one of the Studio's own files, and asserts there were none. A feature
 * that reaches for the network some way other than through the Studio's
 * client (an upload URL, a raw `fetch`) breaks the demo, and this is where it
 * shows. See `docs/plans/demo-mode.md`.
 */

const TITLE = "Coffee, roasted this week";

/** Fails, and records, every request the in-tab server should have answered. */
async function refuseTheNetwork(page: Page): Promise<string[]> {
  const escaped: string[] = [];
  await page.route("**/api/val/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/api/val/static")) {
      return route.continue();
    }
    escaped.push(`${route.request().method()} ${url.pathname}`);
    return route.abort();
  });
  return escaped;
}

/** The home page's title field, in the Studio. */
function titleField(page: Page) {
  return page
    .locator(`[data-val-studio-path$='"hero"."title"']`)
    .getByRole("textbox")
    .first();
}

/** The page in the Studio's canvas. */
function canvas(page: Page) {
  return page.frameLocator('iframe[title^="Preview of"]');
}

async function openDemo(page: Page) {
  // `/val` redirects to the home page with the canvas open.
  await page.goto("/val");
  await expect(titleField(page)).toBeVisible({ timeout: 60_000 });
}

async function closeTour(page: Page) {
  const tour = page.getByRole("dialog").filter({ hasText: "Welcome to Val" });
  if (await tour.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden();
  }
}

test.describe("the demo", () => {
  test("an edit shows in the page, and nothing is sent anywhere", async ({
    page,
  }) => {
    const escaped = await refuseTheNetwork(page);
    await openDemo(page);
    await closeTour(page);

    await expect(canvas(page).locator("h1")).toHaveText(TITLE, {
      timeout: 30_000,
    });
    await titleField(page).fill("Hello from the demo");
    await expect(canvas(page).locator("h1")).toHaveText("Hello from the demo");

    expect(escaped).toEqual([]);
  });

  test("edits last for the tab, and Reset forgets them", async ({ page }) => {
    const escaped = await refuseTheNetwork(page);
    await openDemo(page);
    await closeTour(page);
    await titleField(page).fill("Kept across a reload");
    // Saved on a pause in typing, so wait for the store to hold it rather
    // than for a status that was already showing before the edit.
    await expect
      .poll(
        () => page.evaluate(() => sessionStorage.getItem("val-demo:patches")),
        { timeout: 15_000 },
      )
      .toContain("Kept across a reload");

    await page.reload();
    await expect(titleField(page)).toHaveValue("Kept across a reload", {
      timeout: 60_000,
    });

    await page.getByRole("button", { name: "Reset demo" }).click();
    await expect(titleField(page)).toHaveValue(TITLE, { timeout: 60_000 });

    expect(escaped).toEqual([]);
  });

  test("the tour opens on a first visit, and not again in the same tab", async ({
    page,
  }) => {
    await refuseTheNetwork(page);
    await openDemo(page);
    const tour = page.getByRole("dialog").filter({ hasText: "Welcome to Val" });
    await expect(tour).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tour).toBeHidden();

    await page.reload();
    await expect(titleField(page)).toBeVisible({ timeout: 60_000 });
    await expect(tour).toBeHidden();
  });

  test("Publish says what it would do instead of doing it", async ({
    page,
  }) => {
    const escaped = await refuseTheNetwork(page);
    await openDemo(page);
    await closeTour(page);
    await page.getByRole("button", { name: "Publish" }).first().click();
    await expect(page.getByText("Publishing is off in the demo")).toBeVisible();
    expect(escaped).toEqual([]);
  });
});
