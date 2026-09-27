import { expect, test, type Page } from "@playwright/test";
import {
  clearPatchChain,
  closeNavPanel,
  expandRow,
  openSiteMap,
  openStudio,
  patchThroughStore,
} from "./studio";

/**
 * The fields view's "changed only" filter, against the real Studio.
 *
 * The matcher behind it has unit tests; what they cannot see is the rest of
 * the chain that decides what a person is shown — the comparison with the
 * published value, the count on the chip, the filter itself, and what a pick
 * on the page does to it. Each of those was got wrong once while this was
 * built, and each only showed in a browser.
 */

const BLOG = "/app/blogs/[blog]/page.val.ts";

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

test("lists the fields whose value differs from what is published", async ({
  page,
}) => {
  const studio = await openFieldsView(page);
  const toggle = studio.getByRole("button", {
    name: "Show changed fields only",
  });
  const changed = studio.locator("[data-canvas-field-changed]");
  await expect(toggle).toBeDisabled();

  // Changed, then changed back: patches exist, but nothing differs.
  await patchThroughStore(page, BLOG, [
    { op: "replace", path: ["/blogs/blog1", "title"], value: "Temporary" },
  ]);
  await expect(toggle).toContainText("1");
  await patchThroughStore(page, BLOG, [
    { op: "replace", path: ["/blogs/blog1", "title"], value: "Blog 1" },
  ]);
  await patchThroughStore(page, BLOG, [
    {
      op: "replace",
      path: ["/blogs/blog1", "link", "label"],
      value: "Read on",
    },
  ]);
  await expect(toggle).toContainText("1");
  await expect(changed).toHaveCount(1);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const rows = studio.locator("[data-canvas-field]");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-canvas-field", /"label"/);

  await toggle.click();
  await expect(rows).not.toHaveCount(1);
});

test("a pick on the page of an unchanged field turns the filter off", async ({
  page,
}) => {
  const studio = await openFieldsView(page);
  await patchThroughStore(page, BLOG, [
    {
      op: "replace",
      path: ["/blogs/blog1", "title"],
      value: "Blog 1, revised",
    },
  ]);
  const toggle = studio.getByRole("button", {
    name: "Show changed fields only",
  });
  await expect(toggle).toContainText("1");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const frame = studio.locator("iframe").contentFrame();

  // A changed field is already in the column: the filter stays.
  await frame.getByText("Blog 1, revised").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // An unchanged one is not, so the filter gets out of the way.
  await frame.getByText("Blog 1 content").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(
    studio.locator('[data-canvas-field*="content"]').first(),
  ).toBeVisible();
});
