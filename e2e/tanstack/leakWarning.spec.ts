import path from "node:path";
import { createRequire } from "node:module";
import { expect, type Page } from "@playwright/test";
import { test } from "../studio";

/**
 * The leak warning (`watchStegaLeaks` in `@valbuild/react/stega`, started by
 * `ValProvider` in development with analytics on): every edit tag that reached
 * the page somewhere `autoTagJSX` could not take it out is named in the
 * console, with what to do about it.
 *
 * Against the showcase's post page, which writes JSON-LD and a share link the
 * right way -- through `val.raw()` -- so it must warn about nothing; then with
 * a title, JSON-LD and a share link put on it that each leak one tag, which it
 * must name, all three.
 */

const POST = "/posts/hello-world";
const TITLE_PATH =
  '/src/routes/_site.posts.$postId.val.ts?p="/posts/hello-world"."title"';
const LEAK = /with its edit tag still in it/;

/** An edit tag, as `stegaEncode` writes one, for a value at `valPath`. */
function tagged(text: string, valPath: string): string {
  const combine: (
    text: string,
    json: { origin: string; data: { valPath: string } },
    skip: boolean,
  ) => string = createRequire(
    path.join(process.cwd(), "packages/react/package.json"),
  )("@vercel/stega").vercelStegaCombine;
  return combine(text, { origin: "val.build", data: { valPath } }, false);
}

function leakWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (LEAK.test(message.text())) {
      warnings.push(message.text());
    }
  });
  return warnings;
}

/** The post, hydrated and re-rendered with its edit tags. */
async function openPost(page: Page) {
  await page.goto(POST);
  await expect(
    page.locator("h1[data-val-path]", { hasText: "Hello world" }),
  ).toBeVisible();
}

test.describe("the leak warning", () => {
  test("content passed through val.raw() leaves the page clean", async ({
    page,
  }) => {
    const warnings = leakWarnings(page);
    await openPost(page);

    const jsonLd = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    expect(JSON.parse(jsonLd ?? "null")).toMatchObject({
      headline: "Hello world",
      author: "Fredrik Ekholdt",
    });
    await expect(
      page.getByRole("link", { name: "Share this post" }),
    ).toHaveAttribute("href", /text=Hello%20world$/);

    // The scan runs a second after the page settles.
    await page.waitForTimeout(2_500);
    expect(warnings).toEqual([]);
  });

  test("a title, JSON-LD and a share link that leak are each named", async ({
    page,
  }) => {
    const warnings = leakWarnings(page);
    await openPost(page);
    const title = tagged("Hello world", TITLE_PATH);
    await page.evaluate((title) => {
      document.title = title;
      const jsonLd = document.createElement("script");
      jsonLd.type = "application/ld+json";
      jsonLd.textContent = JSON.stringify({ headline: title });
      document.head.append(jsonLd);
      const share = document.createElement("a");
      share.id = "leaky-share";
      share.href = `https://bsky.app/intent/compose?text=${encodeURIComponent(title)}`;
      document.body.append(share);
    }, title);

    const where = (place: string) =>
      `[val] Content from ${TITLE_PATH} reached ${place} with its edit tag still in it. Wrap the value in val.raw() where it leaves React.`;
    await expect
      .poll(() => [...warnings].sort())
      .toEqual(
        [
          where("<title>"),
          where('<script type="application/ld+json">'),
          where('the href attribute of <a id="leaky-share">'),
        ].sort(),
      );
  });
});
