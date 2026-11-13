import {
  expect,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";
import { discardAll, openStudio, test } from "../studio";
import { serverSource } from "./serverState";

/**
 * `ValComponentEditor`: a list of sections arranged on the page itself.
 *
 * The showcase's `/landing` renders its sections with the components their
 * schemas link them to (`_site.landing.val.ts`), and in the canvas the editor
 * moves, adds and removes them where they are shown. All of it crosses the
 * frame: the page asks (`componentEdit`), the Studio writes the patch, and
 * the page is handed the result. Only a real page in a real frame says that
 * works, and the server says the edit was really made.
 */
const MODULE = "/src/routes/_site.landing.val.ts";
const STUDIO = `/val/~${MODULE}?p=${encodeURIComponent('"/landing"')}`;

/** A laptop: Content and the preview side by side (`workspaceLayout`). */
test.use({ viewport: { width: 1512, height: 900 } });

/** The `type` of every section of `/landing`, as the server holds them. */
async function serverSections(
  request: Parameters<typeof serverSource>[0],
): Promise<unknown[]> {
  const source = await serverSource(request, MODULE);
  const page =
    typeof source === "object" && source !== null
      ? Reflect.get(source, "/landing")
      : undefined;
  const sections =
    typeof page === "object" && page !== null
      ? Reflect.get(page, "sections")
      : undefined;
  return Array.isArray(sections)
    ? sections.map((section: unknown) =>
        typeof section === "object" && section !== null
          ? Reflect.get(section, "type")
          : section,
      )
    : [];
}

/** The sections on the page: the items of the page's own list, in order. */
function sectionsOf(frame: FrameLocator) {
  return frame
    .locator("main > [data-val-component-list]")
    .first()
    .locator(":scope > [data-val-component]");
}

/**
 * The canvas with `/landing` in it, once the page is listening: the page
 * reporting its fields ("On this page") is the page's bridge having mounted,
 * which is after hydration and so after the controls can hear the pointer.
 */
async function openLanding(page: Page): Promise<FrameLocator> {
  await openStudio(page, STUDIO);
  await page.getByRole("button", { name: "Open the canvas" }).click();
  await expect(page.getByRole("tab", { name: /On this page \d/ })).toBeVisible({
    timeout: 60_000,
  });
  // The controls are drawn only while Edit is on.
  await page.getByRole("button", { name: "Edit on the page" }).click();
  return page.frameLocator('iframe[title="Preview of /landing"]');
}

/**
 * Bring up the controls of one item. The pointer is moved onto it twice, a
 * few pixels apart: the controls follow the pointer MOVING, and one that is
 * already resting where it was put has nothing to say.
 */
async function showControls(frame: FrameLocator, item: Locator, y = 20) {
  await expect(async () => {
    await item.hover({ position: { x: 30, y } });
    await item.hover({ position: { x: 36, y: y + 4 } });
    await expect(frame.locator("[data-val-component-toolbar]")).toBeVisible({
      timeout: 2_000,
    });
  }, "hovering an item did not show its controls").toPass({
    timeout: 30_000,
  });
}

test.describe("arranging sections on the page", () => {
  test.afterEach(async ({ page }) => {
    await discardAll(page);
  });

  test("a section is moved, added and removed where it is shown", async ({
    page,
    request,
  }) => {
    const frame = await openLanding(page);
    const sections = sectionsOf(frame);
    await expect(sections).toHaveCount(4, { timeout: 60_000 });
    expect(await serverSections(request)).toEqual([
      "hero",
      "columns",
      "quote",
      "note",
    ]);

    // The controls belong to the section under the pointer.
    await showControls(frame, sections.nth(0));

    // Moved down: the hero is now second, on the page and on the server.
    await frame.getByRole("button", { name: "Move down" }).click();
    await expect(sections.nth(1)).toContainText("Ship content, not tickets");
    await expect
      .poll(() => serverSections(request))
      .toEqual(["columns", "hero", "quote", "note"]);

    // Dragged: the quote, by its handle, to above the first section.
    await showControls(frame, sections.nth(2));
    const handle = await frame
      .getByRole("button", { name: "Drag to move" })
      .boundingBox();
    const first = await sections.nth(0).boundingBox();
    if (handle === null || first === null) {
      throw new Error("the drag handle or the first section has no box");
    }
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(first.x + 200, first.y + 8, { steps: 12 });
    await expect(
      frame.locator("[data-val-component-drop]"),
      "dragging did not show where the section would land",
    ).toBeVisible();
    await page.mouse.up();
    await expect
      .poll(() => serverSections(request))
      .toEqual(["quote", "columns", "hero", "note"]);
    await expect(sections.nth(0)).toContainText("We stopped writing");

    // Added: the Studio asks which kind, and the page shows the new one.
    await showControls(frame, sections.nth(0));
    await frame
      .getByRole("button", { name: "Add a section after this one" })
      .click();
    await page.getByTestId("add-component-note").click();
    await expect(sections).toHaveCount(5);
    await expect
      .poll(() => serverSections(request))
      .toEqual(["quote", "note", "columns", "hero", "note"]);

    // Removed, after being asked twice.
    await showControls(frame, sections.nth(1), 8);
    const remove = frame.getByRole("button", { name: "Remove this section" });
    await remove.click();
    await remove.click();
    await expect(sections).toHaveCount(4);
    await expect
      .poll(() => serverSections(request))
      .toEqual(["quote", "columns", "hero", "note"]);
  });

  test("a list inside a component has controls of its own", async ({
    page,
    request,
  }) => {
    const frame = await openLanding(page);
    const cards = frame.locator(".landing-cards > [data-val-component]");
    await expect(cards).toHaveCount(3, { timeout: 60_000 });

    await cards.nth(0).scrollIntoViewIfNeeded();
    await showControls(frame, cards.nth(0));
    // The cards run across, so "down" the list is to the right.
    await frame.getByRole("button", { name: "Move down" }).click();
    await expect(cards.nth(0)).toContainText("A component");
    await expect(cards.nth(1)).toContainText("A schema");

    // Dragged by its outline rather than its handle: the last card, grabbed
    // at its top edge (the middle of a side is its add button), to before
    // the first.
    await showControls(frame, cards.nth(2));
    const last = await cards.nth(2).boundingBox();
    const firstCard = await cards.nth(0).boundingBox();
    if (last === null || firstCard === null) {
      throw new Error("a card has no box");
    }
    await page.mouse.move(last.x + last.width / 3, last.y + 3);
    await page.mouse.down();
    await page.mouse.move(firstCard.x + 8, firstCard.y + firstCard.height / 2, {
      steps: 12,
    });
    await expect(
      frame.locator("[data-val-component-drop]"),
      "dragging by the outline did not show where the card would land",
    ).toBeVisible();
    await page.mouse.up();
    await expect(cards.nth(0)).toContainText("Content");
    await expect(cards.nth(1)).toContainText("A component");

    // A click on a field inside a card opens that field, not the card.
    await cards.nth(0).getByText("Content", { exact: true }).click();
    await expect
      .poll(() => decodeURIComponent(page.url()))
      .toMatch(/"cards"\.0\."title"/);
    // ...and puts the cursor in it, inside the card's row of On this page.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active =
            document.getElementById("val-shadow-root")?.shadowRoot
              ?.activeElement;
          return active instanceof HTMLInputElement ||
            active instanceof HTMLTextAreaElement
            ? active.value
            : (active?.textContent ?? null);
        }),
      )
      .toBe("Content");
    // The sections around them did not move.
    expect(await serverSections(request)).toEqual([
      "hero",
      "columns",
      "quote",
      "note",
    ]);
  });
});
