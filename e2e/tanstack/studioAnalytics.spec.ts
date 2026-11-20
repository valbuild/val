import { expect, type Page } from "@playwright/test";
import { openStudio, test } from "../studio";
import { TANSTACK_PROJECT } from "./config";

/**
 * Content analytics in the Studio: beside the content being edited, in how
 * many page views each field, list row and module was seen, asked of Val
 * Build through this app's admin proxy.
 *
 * Val Build is played by the test: the showcase runs in fs mode with no
 * `val login`, so `/admin/status` is answered "connected" and the proxy with
 * one module's counts. What is under test is the Studio's half -- the
 * request it makes, and what it draws from the answer.
 */

const MODULE = "/src/routes/_site.posts.$postId.val.ts";
const at = (key: string, field?: string) =>
  `${MODULE}?p=${JSON.stringify(key)}${field ? `.${JSON.stringify(field)}` : ""}`;

async function playValBuild(page: Page) {
  const asked: string[] = [];
  await page.route("**/api/val/admin/status", (route) =>
    route.fulfill({
      json: { connected: true, signIn: "val-login" },
    }),
  );
  await page.route("**/api/val/admin/proxy/**", (route) => {
    const url = new URL(route.request().url());
    asked.push(`${url.pathname}${url.search}`);
    expect(route.request().headers()["x-val-studio"]).toBe("1");
    return route.fulfill({
      json: {
        from: "2026-09-27",
        to: new Date().toISOString().slice(0, 10),
        live: { status: "past" },
        since: "2026-09-01T00:00:00.000Z",
        module: url.searchParams.get("module"),
        paths:
          url.searchParams.get("module") === MODULE
            ? [
                {
                  path: at("/posts/hello-world", "title"),
                  rendered: 2_000,
                  viewed: 1_234,
                },
                {
                  path: at("/posts/hello-world", "body"),
                  rendered: 2_000,
                  viewed: 410,
                },
              ]
            : [],
        total: 2,
      },
    });
  });
  return asked;
}

test("a post's fields say in how many page views they were seen, from one request", async ({
  page,
}) => {
  const asked = await playValBuild(page);
  await openStudio(
    page,
    `/val/~${MODULE}?p=${encodeURIComponent(JSON.stringify("/posts/hello-world"))}`,
  );

  const summary = page.getByTestId("content-views-summary");
  await expect(summary).toContainText(
    "Seen in 1,234 of the 2,000 page views it was on",
  );
  // The most seen fields, by the names the Studio gives them.
  await expect(summary.getByRole("button", { name: /Title/ })).toBeVisible();

  const badges = page.getByTestId("content-views");
  await expect(badges.first()).toBeVisible();
  await expect(badges).toHaveText(["1.2k", "410"]);

  expect(asked.filter((url) => url.includes("/analytics/module"))).toEqual([
    `/api/val/admin/proxy/orgs/${TANSTACK_PROJECT.split("/")[0]}/projects/${TANSTACK_PROJECT.split("/")[1]}/analytics/module?module=${encodeURIComponent(MODULE)}`,
  ]);
});

test("the list of posts says how often each was seen", async ({ page }) => {
  await playValBuild(page);
  await openStudio(page, `/val/~${MODULE}`);
  await expect(page.getByTestId("content-views").first()).toHaveText("1.2k");
});
