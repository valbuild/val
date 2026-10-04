import { expect, test, type Page } from "@playwright/test";
import { mock, openHttpStudio, sessionCookie } from "./httpMode";

/**
 * A Studio open across a schema deploy asks for a reload.
 *
 * `schemaFreshness.test.ts` has the rules at the store level. This is the
 * wiring — `/stat` through `ValProvider` and `ValStoreProvider` to the watch,
 * and the dialog — and the one fact no unit test can establish: that the
 * schema hash the BROWSER bundle folds is the one the SERVER's Node bundle
 * folds. If those disagreed the watch would never arm, silently, and a deploy
 * would go unannounced exactly as before.
 *
 * "A new schema" is made by rewriting `/stat`'s `schemaSha`, because the
 * harness runs one build for the whole run.
 */

const DIALOG = "A new version has been deployed";

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.beforeEach(async () => {
  await mock.reset();
});

function runningSchemaSha(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const stores: unknown = Reflect.get(window, "__VAL_STORES__");
    const system: unknown = Reflect.get(Object(stores), "system");
    const host: unknown = Reflect.get(Object(system), "host");
    const schemaSha: unknown = Reflect.get(Object(host), "schemaSha");
    if (typeof schemaSha !== "function") throw new Error("no host.schemaSha");
    return schemaSha.call(host);
  });
}

test("the page's schema hash is the server's", async ({ page }) => {
  const served = page
    .waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        new URL(res.url()).pathname === "/api/val/stat",
    )
    .then(async (res) => Reflect.get(Object(await res.json()), "schemaSha"));

  await openHttpStudio(page);

  expect(await runningSchemaSha(page)).toBe(await served);
  await expect(
    page.locator("#val-shadow-root").getByText(DIALOG),
  ).not.toBeVisible();
});

test("a schema deployed under an open Studio asks for a reload", async ({
  page,
}) => {
  let deployed = false;
  await page.route("**/api/val/stat", async (route) => {
    if (route.request().method() !== "POST" || !deployed) {
      return route.fallback();
    }
    const response = await route.fetch();
    const json: unknown = await response.json();
    await route.fulfill({
      response,
      json: { ...Object(json), schemaSha: "the-schema-of-a-newer-build" },
    });
  });
  await openHttpStudio(page);
  const studio = page.locator("#val-shadow-root");
  await expect(studio.getByText(DIALOG)).not.toBeVisible();

  deployed = true;
  // A deploy arrives as a commit, which the content service announces over
  // the socket, and the Studio asks `/stat` again.
  await mock.pushCommit({ commitMessage: "a deploy with a new schema" });

  await expect(studio.getByText(DIALOG)).toBeVisible({ timeout: 30_000 });
  await expect(
    studio.getByRole("button", { name: "Reload" }),
    "the dialog offers no way out but the one that works",
  ).toBeVisible();
});
