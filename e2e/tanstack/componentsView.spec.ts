import { expect } from "@playwright/test";
import { contentSelectOn, discardAll, openStudio, test } from "../studio";

/**
 * The Components view (`/val/components`): every component the showcase
 * links (`_site.landing.val.ts`), rendered by the site on its own preview
 * route in a frame, and every place each one is used.
 *
 * Only a real page in a real frame says the preview route answers, and that
 * an edit made beside it reaches it.
 */
test.use({ viewport: { width: 1512, height: 900 } });

test("the rail opens every component, rendered by the site", async ({
  page,
}) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Components" }).click();
  await expect(page).toHaveURL(/\/val\/components/);
  const board = page.getByTestId("components-board");
  await expect(board).toBeVisible();
  // "Callout" is the name it was given, the rest are named by their kind
  for (const name of ["Hero", "Quote", "Callout", "Columns", "Card"]) {
    await expect(page.getByTestId(`component-card-${name}`)).toBeVisible();
  }
  await expect(page.getByTestId("component-card-Card")).toContainText("3 uses");
  // Laid out like a page: the components in the preview's place, which
  // the Preview switch hides and shows as it does the page
  const panes = page.getByRole("group", { name: "Workspace panes" });
  await expect(page.getByTestId("components-index")).toContainText("Card");
  await panes.getByRole("button", { name: "Close the canvas" }).click();
  await expect(board).toBeHidden();
  await expect(page.getByTestId("components-index")).toBeVisible();
  await panes.getByRole("button", { name: "Open the canvas" }).click();
  await expect(board).toBeVisible();

  // The site renders it: the hero's headline, from the content
  await expect(
    page
      .frameLocator('iframe[title^="Hero"]')
      .getByText("Ship content, not tickets"),
  ).toBeVisible({ timeout: 30_000 });
});

test("one component, use by use, and an edit beside it reaches the frame", async ({
  page,
}) => {
  await openStudio(page, "/val/components");
  await page.getByTestId("component-card-Card").click();
  await expect(page).toHaveURL(/component=/);
  const position = page.getByTestId("component-instance-position");
  await expect(position).toHaveText("1 of 3");
  const frame = page.frameLocator('iframe[title^="Card:"]');
  await expect(frame.getByText("A schema")).toBeVisible({ timeout: 30_000 });

  // → is the next use, and the address says which
  await page
    .getByTestId("component-detail")
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ArrowRight");
  await expect(position).toHaveText("2 of 3");
  await expect(page).toHaveURL(/use=2/);
  await expect(
    frame.getByText("Yours, linked with a lazy import."),
  ).toBeVisible({ timeout: 30_000 });

  // Every use side by side
  await page.getByRole("radio", { name: "Every use side by side" }).click();
  await expect(
    page.getByTestId("component-instances").locator("li"),
  ).toHaveCount(3);
  await page.getByRole("radio", { name: "One at a time" }).click();

  // The fields of the use on screen are in the Content pane, beside the
  // components in the preview's place: an edit there is rendered. The card's
  // first field is its title.
  const fields = page.getByTestId("component-fields");
  await expect(fields).toContainText("Use 2 of 3");
  const title = fields.getByRole("textbox").first();
  await title.fill("A component, edited here");
  await expect(frame.getByText("A component, edited here")).toBeVisible({
    timeout: 30_000,
  });
  await discardAll(page);
});

test("a search finds the content of a component, and opens that use", async ({
  page,
}) => {
  await openStudio(page, "/val/components");
  await page
    .getByRole("searchbox", { name: "Search the content of the components" })
    .fill("lazy import");
  const results = page.getByTestId("component-search-results");
  await expect(results).toContainText("Card · use 2 of 3", {
    timeout: 30_000,
  });
  await results.getByRole("option").first().click();
  await expect(page).toHaveURL(/use=2/);
  await expect(page.getByTestId("component-instance-position")).toHaveText(
    "2 of 3",
  );
});

test("a page's components, stacked as its content has them", async ({
  page,
}) => {
  await openStudio(page, "/val/components");
  await page.getByRole("radio", { name: "Pages" }).click();
  await page
    .getByTestId("component-pages-list")
    .getByRole("button", { name: /\/landing/ })
    .click();
  await expect(page).toHaveURL(/mode=pages/);
  // The sections one after another, the cards inside the columns section
  const blocks = page.getByTestId("component-pages").locator("section");
  await expect(blocks.first()).toContainText("Hero");
  const columns = page.getByTestId("component-block-Columns");
  await expect(columns.getByTestId("component-block-Card")).toHaveCount(3);
  await expect(
    page
      .frameLocator('iframe[title^="Hero at"]')
      .getByText("Ship content, not tickets"),
  ).toBeVisible({ timeout: 30_000 });
  // Picking one in the outline shows its fields in Content
  await page
    .getByTestId("component-page-outline")
    .getByRole("button", { name: /^Columns/ })
    .click();
  await expect(page).toHaveURL(/block=/);
  await expect(page.getByTestId("component-page-outline")).toContainText(
    "Heading",
  );
  // The same Select as beside a page's preview
  await expect(contentSelectOn(page)).toBeVisible();
});

test("the Preview switch's menu chooses between the page and the components", async ({
  page,
}) => {
  await openStudio(
    page,
    `/val/~/src/routes/_site.landing.val.ts?p=${encodeURIComponent('"/landing"')}`,
  );
  await page.getByRole("button", { name: "Other ways to preview" }).click();
  await page.getByRole("menuitemradio", { name: /Components/ }).click();
  await expect(page).toHaveURL(/\/val\/components/);
  await expect(page.getByTestId("components-board")).toBeVisible();
  // Back to the page that was open
  await page.getByRole("button", { name: "Other ways to preview" }).click();
  await page.getByRole("menuitemradio", { name: /Page/ }).click();
  await expect(page).toHaveURL(/_site\.landing\.val\.ts/);
});

test("Select & edit types in the component's preview", async ({ page }) => {
  await openStudio(page, "/val/components");
  await page.getByTestId("component-card-Card").click();
  await page
    .getByRole("button", { name: "Choose what selecting on the page does" })
    .click();
  await page.getByRole("menuitemradio", { name: /Select & edit/ }).click();
  const frame = page.frameLocator('iframe[title^="Card:"]');
  await frame.getByText("A schema").click({ timeout: 30_000 });
  await page.keyboard.press("End");
  await page.keyboard.type(" here");
  // Written as the field in Content writes it
  await expect(
    page.getByTestId("component-fields").getByRole("textbox").first(),
  ).toHaveValue("A schema here", { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await discardAll(page);
});

test("a linked object's fields lead to it in the Components view", async ({
  page,
}) => {
  await openStudio(
    page,
    `/val/~/src/routes/_site.landing.val.ts?p=${encodeURIComponent('"/landing"')}`,
  );
  await page
    .getByRole("button", { name: "Show in Components" })
    .first()
    .click();
  await expect(page).toHaveURL(/\/val\/components\?.*component=/);
  await expect(page.getByTestId("component-fields")).toContainText(
    "Call to action",
  );
});
