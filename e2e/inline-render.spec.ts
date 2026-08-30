import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { chainLength, clearPatchChain, openStudio } from "./studio";

/**
 * `.render({ as: "inline" })` on the items of an array, end to end.
 *
 * The rule this pins is the one that was quietly not happening: an inline item
 * is EDITED IN ITS ROW, and it counts as inline even when the render is
 * declared on the VARIANTS of a tagged union rather than on the union itself —
 * which is how a page-builder list is written (`s.array(s.union("type", block,
 * block))`). Declared that way it used to fall all the way back to preview
 * rows, so the list looked exactly the same with the render as without it.
 *
 * The second rule is precedence: the `code` block in this fixture declares BOTH
 * `.render({ as: "inline" })` and a `.preview(...)`. The render decides the
 * field — the row is an editor, not a preview card — and the preview is left to
 * describe the value where it is only referred to, which in this list is the
 * row's own collapsible header.
 */
const PAGE =
  "/val/~/app/generic/[[...path]]/page.val.ts?p=%22%2Fgeneric%2Ftest%2Ffoo%22";

const TEXT = "This is a test page with some text content.";
const CODE = 'console.log("This is a code section in the test page.");';

/**
 * The rows of the `sections` list, which is the only inline list on the page.
 *
 * By `data-val-studio-path`, the attribute the Studio scrolls to a path with,
 * so a row is located the same way the app locates one.
 */
function rows(studio: Locator): Locator {
  return studio.locator("[data-val-studio-path*='\"sections\".']");
}

async function openPage(page: Page): Promise<Locator> {
  await openStudio(page, PAGE);
  const studio = page.locator("#val-shadow-root");
  await expect(rows(studio), "the sections list never rendered").toHaveCount(
    2,
    {
      timeout: 30000,
    },
  );
  return studio;
}

test.describe("an array of inline items", () => {
  test.beforeEach(async ({ request }) => {
    await clearPatchChain(request);
  });

  test("edits each item in its row, union variants included", async ({
    page,
  }) => {
    const studio = await openPage(page);

    // The editors are HERE, in the list, rather than behind a row that
    // navigates to them: this is the whole of what inline means. Both blocks
    // declare the render on the union's variants, and neither is a `string` —
    // the type that used to be inlined implicitly.
    const richText = rows(studio).first().locator("[contenteditable='true']");
    await expect(richText).toHaveCount(1);
    await expect(richText).toContainText(TEXT);
    const code = rows(studio).last().locator(".cm-content");
    await expect(code).toHaveCount(1);
    await expect(code).toContainText(CODE);

    // Each row carries its variant's tag selector, which is what makes the
    // union the thing being edited in place rather than a link to it.
    await expect(rows(studio).first().getByRole("combobox")).toContainText(
      "text",
    );
    await expect(rows(studio).last().getByRole("combobox")).toContainText(
      "code",
    );

    // And nothing navigated away to get there.
    expect(new URL(page.url()).searchParams.get("p")).toBe(
      '"/generic/test/foo"',
    );
  });

  test("adding an item appends a row instead of opening a page", async ({
    page,
  }) => {
    const studio = await openPage(page);
    const before = await chainLength(page);

    await studio.getByRole("button", { name: "Add" }).last().click();

    await expect(rows(studio)).toHaveCount(3);
    await expect
      .poll(() => chainLength(page), {
        message: "adding an inline item never reached the patch chain",
      })
      .toBeGreaterThan(before);
    // An inline item has no page of its own to be sent to — see `getNavPath`.
    expect(new URL(page.url()).searchParams.get("p")).toBe(
      '"/generic/test/foo"',
    );
  });

  test("a declared preview titles the row without taking the editor away", async ({
    page,
  }) => {
    const studio = await openPage(page);
    const codeRow = rows(studio).last();

    // `.preview(({ val }) => ({ title: val.code }))`, in the header...
    const header = codeRow.getByRole("button", { name: CODE });
    await expect(header).toHaveCount(1);
    // ...and the field is still the editor, not the preview card.
    await expect(codeRow.locator(".cm-content")).toContainText(CODE);

    // The header collapses the editor away, which is what the title is for:
    // something to read when the fields are folded.
    await header.click();
    await expect(codeRow.locator(".cm-content")).toHaveCount(0);
    await expect(header).toBeVisible();
  });
});
