import { expect, test } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { clearPatchChain, openStudio } from "./studio";

/**
 * `.render({ as: "inline" })` on the items of an array, end to end.
 *
 * The spec `studio-ui.spec.ts` says the generic page's inline rows deserve: it
 * is the only thing covering them, and it covers the two rules that made them
 * do nothing at all.
 *
 * The first is that an inline item is EDITED IN ITS ROW, and counts as inline
 * even when the render is declared on the VARIANTS of a tagged union rather
 * than on the union itself — which is how a page-builder list is written
 * (`s.array(s.union("type", block, block))`). Declared that way it used to fall
 * all the way back to preview rows, so the list looked exactly the same with
 * the render as without it.
 *
 * The second is precedence: the `code` block in this fixture declares BOTH
 * `.render({ as: "inline" })` and a `.preview(...)`. The render decides the
 * field — the row is an editor, not a preview card — and the preview is left to
 * describe the value where it is only referred to, which in this list is the
 * row's own collapsible header.
 *
 * Every assertion here reads a boundary (see `e2e/README.md`): the DOM, the
 * browser's own URL, or the patches the SERVER holds. Whether an edit reached
 * the chain is a fact about the server, and the store's own record of it is the
 * thing under test rather than the oracle for it.
 */
const MODULE = "/app/generic/[[...path]]/page.val.ts";
const PAGE = `/val/~${MODULE}?p=%22%2Fgeneric%2Ftest%2Ffoo%22`;

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

/** What the SERVER holds for this module, as patch ops. */
async function serverOps(
  request: APIRequestContext,
): Promise<{ op: string; path: string[] }[]> {
  const res = await request.get("/api/val/patches");
  expect(res.ok(), `the server refused the request: ${res.status()}`).toBe(
    true,
  );
  const body = (await res.json()) as {
    patches: { path: string; patch?: { op: string; path: string[] }[] }[];
  };
  return body.patches
    .filter((patch) => patch.path === MODULE)
    .flatMap((patch) => patch.patch ?? []);
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
    // The rich text editor is a contenteditable that exposes no role of its
    // own; the code editor is a textbox, so it is asked for by role.
    const richText = rows(studio).first().locator("[contenteditable='true']");
    await expect(richText).toHaveCount(1);
    await expect(richText).toContainText(TEXT);
    const code = rows(studio).last().getByRole("textbox");
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
    request,
  }) => {
    const studio = await openPage(page);

    await studio.getByRole("button", { name: "Add" }).last().click();

    await expect(rows(studio)).toHaveCount(3);
    // The row is not the whole claim: an inline list that renders an item it
    // never wrote is the same screen as one that did. The chain starts empty
    // (`clearPatchChain`), so the server should now hold exactly the one add,
    // against the list this button belongs to.
    await expect
      .poll(() => serverOps(request), {
        message: "adding an inline item never reached the server",
      })
      .toEqual([
        expect.objectContaining({
          op: "add",
          path: expect.arrayContaining(["sections"]),
        }),
      ]);
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
    await expect(codeRow.getByRole("textbox")).toContainText(CODE);

    // The header collapses the editor away, which is what the title is for:
    // something to read when the fields are folded.
    await header.click();
    await expect(codeRow.getByRole("textbox")).toHaveCount(0);
    await expect(header).toBeVisible();
  });
});
