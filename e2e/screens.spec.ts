import { test, expect, type Page } from "@playwright/test";
import {
  closeNavPanel,
  discardAll,
  expandRow,
  openNavPanel,
  openSiteMap,
  openStudio,
} from "./studio";

/**
 * Screenshots of the new shell, taken from the real app.
 *
 * Not a test — nothing here asserts anything about correctness — but it lives
 * with the tests because it needs exactly what they need: the app running, the
 * studio taken in, and a way to reach a state worth looking at. Run it with
 * `npx playwright test screens` and look in `screens/`.
 *
 * Kept because a redesign is judged by looking at it, and "open the studio,
 * pick a page, turn on preview mode, switch to the fields view" is a lot of
 * clicking to redo every time someone wants to see where it got to.
 */

const OUT = "screens";

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

/** Open a page in the editor, with the navigation out of the way. */
async function openBlogPost(page: Page) {
  const studio = await openSiteMap(page);
  await expandRow(studio, "blogs");
  await expandRow(studio, "blog1");
  await closeNavPanel(studio, "Pages");
  return studio;
}

test.describe.configure({ mode: "serial" });

test("the shell", async ({ page }) => {
  await openStudio(page);
  const studio = page.locator("#val-shadow-root");
  await page.waitForTimeout(2500);
  await shot(page, "01-resting-state");

  // The site map, with the home page open under it.
  await openSiteMap(page);
  await page.waitForTimeout(1200);
  await shot(page, "02-pages-panel");

  await studio.getByRole("button", { name: "/", exact: true }).click();
  await closeNavPanel(studio, "Pages");
  await page.waitForTimeout(2500);
  await shot(page, "03-editor");

  // Data, as a tree.
  await openNavPanel(page, "Data");
  await page.waitForTimeout(1500);
  await shot(page, "04-data-tree");

  // Media, with a gallery opened to its files.
  await openNavPanel(page, "Media");
  await page.waitForTimeout(1500);
  await studio.getByTitle("/content/media.val.ts").click();
  await page.waitForTimeout(2000);
  await shot(page, "05-media-files");
  await closeNavPanel(studio, "Media");

  // Search, finding content rather than page names.
  await studio
    .getByRole("button", { name: /Search/ })
    .first()
    .click();
  const search = studio.getByLabel("Search the project");
  await expect(search).toBeVisible();
  await search.fill("asked");
  await page.waitForTimeout(5000);
  await shot(page, "06-search-content");
  await page.keyboard.press("Escape");

  // The New page form, with the routes that accept one.
  await openNavPanel(page, "Pages");
  await page.waitForTimeout(1200);
  await studio.getByRole("button", { name: "New page" }).first().click();
  await page.waitForTimeout(1000);
  await shot(page, "06b-new-page");
  // Escape closes the panel with the form, so there is nothing left to close.
  await page.keyboard.press("Escape");

  // Quick actions.
  await studio.getByRole("button", { name: "Quick actions" }).click();
  await page.waitForTimeout(1200);
  await shot(page, "07-quick-actions");
  await page.keyboard.press("Escape");

  // Settings, reachable from the rail's cog in dev mode.
  await studio.getByRole("button", { name: "Settings" }).first().click();
  await page.waitForTimeout(1200);
  await shot(page, "08-settings");
});

test("the canvas", async ({ page }) => {
  await openStudio(page);
  const studio = await openBlogPost(page);

  // The Preview split button, with the canvas and the new tab behind it.
  await studio.getByRole("button", { name: "Other ways to preview" }).click();
  await page.waitForTimeout(600);
  await shot(page, "09-preview-menu");
  await page.keyboard.press("Escape");

  // Preview mode off: the canvas says so rather than showing a dead page.
  await studio.getByRole("button", { name: /Open the canvas/ }).click();
  const enable = studio.getByRole("button", { name: /Turn on preview mode/ });
  await expect(enable).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(800);
  await shot(page, "10-canvas-preview-off");

  await enable.click();
  const fieldsTab = studio.getByRole("tab", { name: /Fields/ });
  await expect(fieldsTab).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await shot(page, "11-canvas-normal");

  // The fields view: real fields, beside the real page.
  await fieldsTab.click();
  await page.waitForTimeout(3000);
  await shot(page, "12-canvas-fields");

  // The address bar, with the routes Val tracks.
  const route = studio.getByLabel("Canvas route");
  await route.click();
  await route.fill("/");
  await page.waitForTimeout(800);
  await shot(page, "13-canvas-route-bar");
  await page.keyboard.press("Escape");

  // Resized, to show the split is draggable.
  const divider = studio.getByRole("separator", {
    name: "Resize the editor and canvas",
  });
  const box = await divider.boundingBox();
  if (box) {
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 220, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    await shot(page, "14-canvas-resized");
  }
});

/** The media fields: which file, what it is of, where to look at it. */
test("media fields", async ({ page }) => {
  await openStudio(page, "/val/~/content/mediaFields.val.ts");
  const studio = page.locator("#val-shadow-root");
  await page.waitForTimeout(3000);

  // Every field in this fixture is nullable and empty, so the bodies only
  // render once a field is switched on. The first is `s.image()` (its own file)
  // and the third is `s.image(gallery)` (a collection), which are the two cases
  // Choose asset behaves differently for.
  const toggles = studio.locator('button[role="checkbox"]');
  await toggles.nth(0).click();
  await toggles.nth(2).click();
  await page.waitForTimeout(2500);
  await shot(page, "19-media-fields");

  // The gallery-backed field's picker, with the upload inside it.
  // The gallery-backed field's Choose asset, which opens a list rather than the
  // file dialog — a dialog is not something a screenshot can show.
  await studio
    .getByRole("combobox", { name: /Choose asset/ })
    .first()
    .click();
  await page.waitForTimeout(1500);
  await shot(page, "20-choose-asset");
  await page.keyboard.press("Escape");
  await discardAll(page);
});

test("light mode", async ({ page }) => {
  await openStudio(page);
  const studio = page.locator("#val-shadow-root");
  await page.waitForTimeout(2500);
  await studio.getByRole("button", { name: "Settings" }).first().click();
  await page.waitForTimeout(1000);
  // The theme switch is a radio group in the settings panel.
  const light = studio.getByRole("radio", { name: "light" });
  await expect(light).toBeVisible();
  await light.click();
  await page.waitForTimeout(1500);
  await shot(page, "15-light-settings");
  await closeNavPanel(studio, "Settings");
  await page.waitForTimeout(1000);
  await shot(page, "16-light-shell");
});

test("mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openStudio(page);
  const studio = page.locator("#val-shadow-root");
  await page.waitForTimeout(3000);
  await shot(page, "17-mobile-resting");
  await studio.getByRole("button", { name: "Open navigation" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "18-mobile-pages");
});
