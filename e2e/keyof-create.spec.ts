import { expect } from "@playwright/test";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { openStudio, test } from "./studio";

/**
 * Referencing an author who does not exist yet, from the blog post.
 *
 * The point is WHERE the writes land. Adding a key from a `keyOf` field is the
 * only edit in the Studio that has to write to a module the field is not in:
 * the entry belongs to the authors record, and only the selection belongs to
 * the post. A version that adds the key to the post's own module renders
 * exactly the same until the source comes back, and `KeyOfField.test.tsx` pins
 * that at the hook. What it cannot see is whether either patch reached the
 * server at all - the bug class `studio.spec.ts` exists for, where the
 * optimistic update looks perfect and nothing is persisted - so both are read
 * back out of the chain here, per `e2e/README.md`.
 *
 * It also caught what jsdom cannot: cmdk hides the GROUP an item is in when the
 * search matches nothing, which is precisely when the create option is needed,
 * and a hidden element is still clickable in jsdom.
 */
const BLOG_MODULE = "/app/blogs/[blog]/page.val.ts";
const AUTHORS_MODULE = "/content/authors.val.ts";
const PAGE = `/val/~${BLOG_MODULE}?p=%22%2Fblogs%2Fblog1%22`;

const NEW_AUTHOR = "sindre";

/** What the SERVER holds, as one flat list of (module, op, path). */
async function serverOps(
  request: APIRequestContext,
): Promise<{ module: string; op: string; path: string[] }[]> {
  const res = await request.get("/api/val/patches");
  expect(res.ok(), `the server refused the request: ${res.status()}`).toBe(
    true,
  );
  const body = (await res.json()) as {
    patches: { path: string; patch?: { op: string; path: string[] }[] }[];
  };
  return body.patches.flatMap((patch) =>
    (patch.patch ?? []).map((op) => ({
      module: patch.path,
      op: op.op,
      path: op.path,
    })),
  );
}

/** The author field's dropdown, which is the only `keyOf` on this page. */
function authorField(studio: Locator): Locator {
  return studio.locator(`[data-val-studio-path*='"author"']`);
}

async function openBlogPost(page: Page): Promise<Locator> {
  await openStudio(page, PAGE);
  const studio = page.locator("#val-shadow-root");
  await expect(
    authorField(studio).getByRole("combobox"),
    "the author field never rendered",
  ).toHaveCount(1, { timeout: 30000 });
  return studio;
}

test.describe("creating a referenced entry from a keyOf field", () => {
  test("writes the entry to the authors module, the reference to the post, and goes to the entry", async ({
    page,
    request,
  }) => {
    const studio = await openBlogPost(page);
    await expect(authorField(studio).getByRole("combobox")).toContainText(
      "Fredrik Ekholdt",
    );

    await authorField(studio).getByRole("combobox").click();
    // Searching first, because this is the state the option exists for: the
    // author is not in the list, which is how the editor gets here at all.
    await studio.getByPlaceholder("Search key...").fill(NEW_AUTHOR);
    await studio.getByText("New entry").click();
    // ...and the key is already what was searched for, under the key schema's
    // own description of what a key is.
    await expect(studio.getByPlaceholder("Key")).toHaveValue(NEW_AUTHOR);
    await expect(
      studio.getByText("Unique identifier for the author"),
    ).toBeVisible();
    await studio.getByRole("button", { name: "Create" }).click();

    // Both writes are on the server, each in ITS OWN module.
    await expect
      .poll(() => serverOps(request), {
        message: "the entry and the reference did not both reach the chain",
      })
      .toEqual(
        expect.arrayContaining([
          { module: AUTHORS_MODULE, op: "add", path: [NEW_AUTHOR] },
          {
            module: BLOG_MODULE,
            op: "replace",
            path: ["/blogs/blog1", "author"],
          },
        ]),
      );

    // And the editor is standing in the new author, which is empty: what was
    // created is a key and a shape, and they still have to say who this is.
    // Pathname and `p` only: the studio also carries its own canvas state in
    // the query, which is not what this asserts.
    await expect
      .poll(
        () => {
          const url = new URL(page.url());
          return `${url.pathname}?p=${url.searchParams.get("p")}`;
        },
        { message: "the studio did not navigate to the new entry" },
      )
      .toBe(`/val/~${AUTHORS_MODULE}?p="${NEW_AUTHOR}"`);
    await expect(
      studio.locator(`[data-val-studio-path*='"name"']`).getByRole("textbox"),
      "the new author's own fields are not on screen",
    ).toHaveValue("");
  });

  test("the menu renders in the Studio's portal, above the combobox", async ({
    page,
  }) => {
    const studio = await openBlogPost(page);
    await authorField(studio).getByRole("combobox").click();

    // In the Studio's own portal node, which is INSIDE the shadow root: a
    // popover portalled to `document.body` lands outside it and loses every
    // Val style, and one left in the field's own box is clipped by it.
    const panel = studio.locator("[data-val-portal] [data-side]");
    await expect(panel, "the menu is not in the Studio's portal").toHaveCount(
      1,
    );
    // Above the row, so it does not cover the fields below it or this row's own
    // "+" and go-to-reference link.
    await expect(panel).toHaveAttribute("data-side", "top");
    // And the portal node is not also sitting on the panel as a DOM attribute,
    // which is what reading it off `props` and spreading the rest did.
    expect(await panel.getAttribute("container")).toBeNull();

    const trigger = await authorField(studio)
      .getByRole("combobox")
      .boundingBox();
    const menu = await panel.boundingBox();
    expect(trigger && menu && menu.y + menu.height <= trigger.y + 1).toBe(true);
  });

  test("the + beside the dropdown opens the same form", async ({ page }) => {
    const studio = await openBlogPost(page);

    // Without opening the list at all: the second entry point is there for the
    // editor who has not.
    await authorField(studio)
      .getByRole("button", { name: "New entry" })
      .click();

    await expect(studio.getByPlaceholder("Key")).toBeVisible();
    await expect(studio.getByPlaceholder("Search key...")).toHaveCount(0);
  });
});
