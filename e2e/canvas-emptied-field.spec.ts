import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  clearPatchChain,
  closeNavPanel,
  expandRow,
  openSiteMap,
  openStudio,
} from "./studio";

/**
 * A field emptied in the fields view stays in the fields view.
 *
 * The column lists what the page reports, and the page only reports what it
 * renders. An empty rich text renders no element, and an inline element whose
 * only text is the invisible edit tag measured 0×0 and was dropped by the
 * bridge — so emptying a field removed the row being typed in, focus and all,
 * and clearing a link's label took its `href` row with it.
 *
 * Unit tests pin the two halves (`canvasBridgeElements.test.tsx`,
 * `useRetainedCanvasPaths.test.tsx`); what only a browser can show is that
 * they meet: a real page collapsing a real element, and the row still there.
 */

const BLOG = "/app/blogs/[blog]/page.val.ts";
/** The row for a field of `/blogs/blog1`, by its module path (`"link"."label"`). */
const row = (studio: Locator, field: string) =>
  studio.locator(
    `[data-canvas-field=${JSON.stringify(`${BLOG}?p="/blogs/blog1".${field}`)}]`,
  );

test.beforeEach(async ({ request }) => {
  await clearPatchChain(request);
});
test.afterAll(async ({ request }) => {
  await clearPatchChain(request);
});

/** The blog post, with the canvas in preview mode and the fields view open. */
async function openFieldsView(page: Page) {
  await openStudio(page);
  const studio = await openSiteMap(page);
  await expandRow(studio, "blogs");
  await expandRow(studio, "blog1");
  await closeNavPanel(studio, "Pages");
  await studio.getByRole("button", { name: /Open the canvas/ }).click();
  const enable = studio.getByRole("button", { name: /Turn on preview mode/ });
  await expect(enable).toBeVisible({ timeout: 25000 });
  await enable.click();
  const fieldsTab = studio.getByRole("tab", { name: /On page/ });
  await expect(fieldsTab).toBeVisible({ timeout: 30000 });
  await fieldsTab.click();
  await expect(studio.locator("[data-canvas-field]").first()).toBeVisible({
    timeout: 60000,
  });
  return studio;
}

const LABEL_PATH = `${BLOG}?p="/blogs/blog1"."link"."label"`;

/**
 * Listen to the page's element reports from here on, as the Studio hears them.
 *
 * The bridge posts to the Studio's window; this adds a second listener beside
 * `CanvasFrame`'s, so a test can wait on the report itself rather than on a
 * clock.
 */
async function recordElementReports(page: Page) {
  await page.evaluate(() => {
    const bag = window as unknown as { __valReports?: unknown[] };
    bag.__valReports = [];
    window.addEventListener("message", (event: MessageEvent) => {
      const data: unknown = event.data;
      if (
        typeof data === "object" &&
        data !== null &&
        "type" in data &&
        data.type === "elements"
      ) {
        bag.__valReports?.push(data);
      }
    });
  });
  return {
    /** Until a report has `path` either missing or on an empty (0×0) box. */
    waitForEmptied: (path: string) =>
      page.waitForFunction(
        (wanted) => {
          type Report = {
            elements: {
              paths: string[];
              rect: { width: number; height: number };
            }[];
          };
          const bag = window as unknown as { __valReports?: Report[] };
          return (bag.__valReports ?? []).some((report) => {
            const element = report.elements.find((candidate) =>
              candidate.paths.includes(wanted),
            );
            return (
              element === undefined ||
              (element.rect.width === 0 && element.rect.height === 0)
            );
          });
        },
        path,
        { timeout: 15000 },
      ),
  };
}

/** Whether keyboard focus is somewhere inside `locator`. */
async function hasFocusWithin(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const root = element.getRootNode();
    const active =
      root instanceof ShadowRoot ? root.activeElement : document.activeElement;
    return active !== null && element.contains(active);
  });
}

test("an emptied rich text keeps its row, and its focus, until the page is reloaded", async ({
  page,
}) => {
  const studio = await openFieldsView(page);
  const content = row(studio, '"content"');
  await expect(content).toBeVisible();

  const editor = content.locator("[contenteditable=true]").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");

  // The page no longer shows it — the marker is the proof — and it is still
  // listed, with the editor still in it.
  await expect(content.locator("[data-canvas-field-off-page]")).toBeVisible({
    timeout: 15000,
  });
  expect(await hasFocusWithin(content)).toBe(true);

  // Reloading asks for the page as it is now, which does not include it.
  await studio.getByRole("button", { name: "Reload the page" }).first().click();
  await expect(content).toHaveCount(0, { timeout: 30000 });
  await expect(row(studio, '"title"')).toBeVisible();
});

test("clearing a link's label keeps both of the link's rows", async ({
  page,
}) => {
  const studio = await openFieldsView(page);
  const label = row(studio, '"link"."label"');
  const href = row(studio, '"link"."href"');
  await expect(label).toBeVisible();
  await expect(href).toBeVisible();

  const reports = await recordElementReports(page);
  await label.locator("input").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  /*
   * Wait for the report the bug was in: the first one in which the label's
   * element is no longer the filled-in link. With the fix it is there, 0×0;
   * without it, it is missing — and either way the rows below are then
   * checked against what the page actually said.
   */
  await reports.waitForEmptied(LABEL_PATH);

  await expect(label).toBeVisible();
  await expect(href).toBeVisible();
  // On the page, just empty: the bridge reports it, so it is not marked.
  await expect(label.locator("[data-canvas-field-off-page]")).toHaveCount(0);
  expect(await hasFocusWithin(label)).toBe(true);
});
