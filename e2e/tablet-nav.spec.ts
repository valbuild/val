import { expect, type Locator, type Page } from "@playwright/test";
import { openStudio, test } from "./studio";

/**
 * Getting from one destination to another on a tablet.
 *
 * The left rail is desktop-only (1200px and up), and the top bar's menu button
 * opens the FIRST destination a project has and nothing else. Between 768px
 * and 1200px — an iPad in either orientation, or a half screen — that left
 * whichever panel happened to be open as the only panel reachable: Data, Media
 * and Settings had no route at all. The switcher that stands in for the rail
 * was gated on the mobile breakpoint, and the tablet width fell through the
 * gap between the two.
 *
 * Driven at a real viewport rather than unit-tested because the bug WAS the
 * viewport: every panel rendered correctly, and each one was fine to look at.
 */
test.use({ viewport: { width: 1024, height: 768 } });

function switcher(studio: Locator): Locator {
  return studio.getByRole("tablist", { name: "Destinations" });
}

function destination(studio: Locator, name: string): Locator {
  return switcher(studio).getByRole("tab", { name });
}

/** Open the studio with one panel already up, and hand back the shadow root. */
async function studioWithPanel(page: Page, panel: string): Promise<Locator> {
  await openStudio(page, `/val?panel=${panel}`);
  return page.locator("#val-shadow-root");
}

test.describe("the destinations on a tablet", () => {
  test("has no rail at this width - that is the premise", async ({ page }) => {
    const studio = await studioWithPanel(page, "pages");
    await expect(studio.getByRole("navigation", { name: "Main" })).toHaveCount(
      0,
    );
  });

  test("reaches Data from the panel the menu button opens", async ({
    page,
  }) => {
    await openStudio(page);
    const studio = page.locator("#val-shadow-root");
    // What the menu button does: the first destination, which is Pages.
    await studio.getByRole("button", { name: "Open navigation" }).click();
    await expect(studio.getByRole("dialog", { name: "Pages" })).toBeVisible();

    await destination(studio, "Data").click();
    await expect(studio.getByRole("dialog", { name: "Data" })).toBeVisible();
    // And back, so this is a switcher rather than a one-way door.
    await destination(studio, "Pages").click();
    await expect(studio.getByRole("dialog", { name: "Pages" })).toBeVisible();
  });

  test("reaches Media and Settings too", async ({ page }) => {
    const studio = await studioWithPanel(page, "data");
    await expect(studio.getByRole("dialog", { name: "Data" })).toBeVisible();

    await destination(studio, "Media").click();
    await expect(studio.getByRole("dialog", { name: "Media" })).toBeVisible();

    await destination(studio, "Settings").click();
    await expect(
      studio.getByRole("dialog", { name: "Settings" }),
    ).toBeVisible();
  });

  test("marks the panel that is open, so the rest read as somewhere to go", async ({
    page,
  }) => {
    const studio = await studioWithPanel(page, "data");
    await expect(destination(studio, "Data")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(destination(studio, "Pages")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

test.describe("the same panels on desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("carry no switcher - the rail is the one there", async ({ page }) => {
    const studio = await studioWithPanel(page, "data");
    await expect(
      studio.getByRole("navigation", { name: "Main" }),
    ).toBeVisible();
    await expect(studio.getByRole("dialog", { name: "Data" })).toBeVisible();
    await expect(switcher(studio)).toHaveCount(0);
  });
});
