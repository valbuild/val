import { expect, type Page } from "@playwright/test";
import { openStudio, test } from "../studio";

/**
 * Picking a language scopes the whole Studio to it.
 *
 * The showcase has all three things that put content in a language: the news
 * router, whose URL names it (`/news/…` is English, `/nb/news/…` Norwegian),
 * and `translated.val.ts`, with a locale-keyed record and a list of posts that
 * each have a locale field. See `docs/plans/locale-scoped-studio.md`.
 */

const NEWS = "/src/routes/_site.{-$locale}.news.$slug.val.ts";
const TRANSLATED = "/src/content/translated.val.ts";
const at = (modulePath: string, path: string) =>
  `/val/~${modulePath}?p=${encodeURIComponent(path)}`;
const ENGLISH_NEWS = at(NEWS, JSON.stringify("/news/val-in-english"));

/** Pick a language in the top bar's picker. */
async function pick(page: Page, tag: string) {
  await page
    .getByRole("button", { name: /^Showing/ })
    .first()
    .click();
  await page.getByRole("menuitemradio").filter({ hasText: tag }).click();
}

/**
 * A row of the Pages tree, by its segment. A button, because the same segment
 * is also printed in the editor's heading and breadcrumb.
 */
function pageRow(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true });
}

/** The `p` the Studio is on, decoded. */
function currentPath(page: Page): string | null {
  return new URL(page.url()).searchParams.get("p");
}

test("the Pages tree lists only the picked language, and pages in none", async ({
  page,
}) => {
  await openStudio(page, "/val?panel=pages&locale=nb-NO");
  await expect(pageRow(page, "val-pa-norsk")).toBeVisible({
    timeout: 30_000,
  });
  await expect(pageRow(page, "val-in-english")).toHaveCount(0);
  // A page in no language is in every one.
  await expect(pageRow(page, "dashboard")).toBeVisible();
});

test("picking a language on a page in another one goes to the Studio's start", async ({
  page,
}) => {
  await openStudio(page, ENGLISH_NEWS);
  await expect(page.getByRole("textbox").first()).toHaveValue(
    "Val, in English",
    { timeout: 30_000 },
  );
  await pick(page, "nb-NO");
  // The Norwegian news page has its own slug, so nothing says it is this
  // page's translation. Nor is any other page a safe place to land: even `/`
  // can be in the language just left. So nothing is selected.
  await expect.poll(() => new URL(page.url()).pathname).toBe("/val");
  await expect(page.getByText("Pick something to edit")).toBeVisible();
  // And the Pages tree no longer lists the English page.
  await expect(page.getByText("Val, in English")).toHaveCount(0);
});

test("picking a language on a translated entry goes to the same entry in it", async ({
  page,
}) => {
  await openStudio(page, at(TRANSLATED, '"announcements"."en-US"'));
  await pick(page, "nb-NO");
  await expect.poll(() => currentPath(page)).toBe('"announcements"."nb-NO"');
});

test("picking a language on a post in another one goes to the list of posts", async ({
  page,
}) => {
  await openStudio(page, at(TRANSLATED, '"posts".1'));
  await pick(page, "nb-NO");
  await expect.poll(() => currentPath(page)).toBe('"posts"');
  await expect(page.getByText("Innhold som kode")).toBeVisible();
  await expect(page.getByText("Content as code")).toHaveCount(0);
});

test("a link to a page in another language opens it, and lists it only while it is open", async ({
  page,
}) => {
  await openStudio(page, `${ENGLISH_NEWS}&panel=pages&locale=nb-NO`);
  await expect(page.getByRole("textbox").first()).toHaveValue(
    "Val, in English",
    { timeout: 30_000 },
  );
  // The filter is unchanged, and the page is listed: it is where the editor is.
  await expect(
    page.getByRole("button", { name: /^Showing/ }).first(),
  ).toContainText("nb-NO");
  await expect(pageRow(page, "val-in-english")).toBeVisible();

  await pageRow(page, "dashboard").click();
  await expect(pageRow(page, "val-in-english")).toHaveCount(0);
});
