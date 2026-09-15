import { expect, test, type Locator, type Page } from "@playwright/test";
import { clearPatchChain, openNavPanel, openStudio } from "./studio";

/**
 * The two writes behind a row's "…" in the site map.
 *
 * The write behind it is not a rename of a label: the router module IS a record
 * and the page's URL is its key, so this is a `move` plus a rewrite of every
 * field that pointed at the old key. Nothing but a real Studio exercises that
 * whole path - the schema lookup, the reference scan, the patch, and the
 * navigate that has to follow the page to where it went.
 *
 * The page under test is created by the test rather than picked out of the
 * example app, so the assertion can be exact - the URL exists afterwards and
 * the old one does not - without depending on content someone may edit.
 */

/** Make a page under `/blogs/[blog]`, and leave the panel open on it. */
async function createPage(
  page: Page,
  pages: Locator,
  key: string,
): Promise<void> {
  await pages.getByRole("button", { name: "New page" }).click();
  const routeSelect = pages.getByLabel("Route");
  if (await routeSelect.count()) {
    await routeSelect.selectOption({ label: "/blogs/[blog]" });
  }
  await pages.locator('input[placeholder="blog"]').fill(key);
  await pages.getByRole("button", { name: "Create" }).click();
  await expect(
    pages.getByRole("button", { name: `Page actions /blogs/${key}` }),
  ).toBeVisible({ timeout: 30000 });
  void page;
}

test("duplicating a page leaves the original where it was", async ({
  page,
  request,
}) => {
  await clearPatchChain(request);
  await openStudio(page);
  const pages = await openNavPanel(page, "Pages");
  await createPage(page, pages, "copy-me");

  // The first of the two options behind the row's "…".
  await pages
    .getByRole("button", { name: "Page actions /blogs/copy-me" })
    .click();
  await pages.getByRole("menuitem", { name: "Duplicate" }).click();
  await pages.locator('input[placeholder="blog"]').fill("copy-me-2");
  await pages.getByRole("button", { name: "Duplicate", exact: true }).click();

  await expect(
    pages.getByRole("button", { name: "Page actions /blogs/copy-me-2" }),
  ).toBeVisible({ timeout: 30000 });
  // A duplicate that took the original with it would be a rename. `exact`,
  // because the copy's URL has the original's as a prefix.
  await expect(
    pages.getByRole("button", {
      name: "Page actions /blogs/copy-me",
      exact: true,
    }),
  ).toBeVisible();
  await clearPatchChain(request);
});

test("renaming a page moves it to the URL that was asked for", async ({
  page,
  request,
}) => {
  await clearPatchChain(request);
  await openStudio(page);
  const pages = await openNavPanel(page, "Pages");
  await createPage(page, pages, "rename-me");

  // The two options behind the row's "…": this is the second one.
  await pages
    .getByRole("button", { name: "Page actions /blogs/rename-me" })
    .click();
  await pages.getByRole("menuitem", { name: "Rename" }).click();
  await pages.locator('input[placeholder="blog"]').fill("renamed");
  await pages.getByRole("button", { name: "Rename", exact: true }).click();

  await expect(
    pages.getByRole("button", { name: "Page actions /blogs/renamed" }),
  ).toBeVisible({ timeout: 30000 });
  // A rename that leaves the original behind is a duplicate.
  await expect(
    pages.getByRole("button", { name: "Page actions /blogs/rename-me" }),
  ).toHaveCount(0);
  await clearPatchChain(request);
});
