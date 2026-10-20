import { expect } from "@playwright/test";
import { openStudio, test } from "../studio";

/**
 * A page whose route has an optional language segment opens in the Studio.
 *
 * TanStack names the route file after the URL, so the showcase's localized
 * news is `src/routes/_site.{-$locale}.news.$slug.val.ts`, and the Studio's
 * address for one of its pages is `/val/~` followed by that path. A browser
 * percent-encodes `{` and `}` in a path, so `location.pathname` reads the
 * module back as `_site.%7B-$locale%7D…`: before the Studio decoded it, every
 * page of a site with its language in the URL was "Not Found" -- including
 * the one the Studio had just linked to.
 */
test("a page under {-$locale} opens in the Studio", async ({ page }) => {
  const modulePath = "/src/routes/_site.{-$locale}.news.$slug.val.ts";
  const key = JSON.stringify("/nb/news/val-pa-norsk");
  await openStudio(page, `/val/~${modulePath}?p=${encodeURIComponent(key)}`);

  expect(new URL(page.url()).pathname).toContain("%7B-$locale%7D");
  await expect(page.getByText("can no longer be found")).toHaveCount(0);
  await expect(page.getByRole("textbox").first()).toHaveValue("Val, på norsk", {
    timeout: 30_000,
  });
});
