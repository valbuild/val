import { expect } from "@playwright/test";
import { discardAll, openStudio, test } from "../studio";

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
  // cannot be switched off, and the list of them in the Content pane
  const panes = page.getByRole("group", { name: "Workspace panes" });
  await expect(
    panes.getByRole("button", { name: "Close the canvas" }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("components-index")).toContainText("Card");
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
