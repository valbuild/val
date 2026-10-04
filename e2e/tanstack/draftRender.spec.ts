import { expect, type Page } from "@playwright/test";
import { openStudio, patchThroughStore, test } from "../studio";

/**
 * A draft page is rendered as the draft by the SERVER, not only in the browser.
 *
 * The hooks render on the server too, and had no draft there: in preview, the
 * server sent the PUBLISHED page and the overlay swapped the draft in once it
 * had loaded in the browser. So every draft page load -- and every reload
 * while a publish was running, which is when people look -- showed the old
 * text first and the new text a moment later.
 *
 * `fetchValDraft` reads the draft for the request and `<ValProvider draft>`
 * renders with it; the browser hydrates from the same sources. These tests
 * read the HTML the server sends, which is what the first paint is.
 */

const DRAFT = "Rendered as the draft, on the server";
const PUBLISHED = "Content as code, in a TanStack Start app.";
/** The zero-width characters Val's edit tags are written in. */
const STEGA = /[​-‍﻿⁠-⁤]/;

/** The text of the HTML the server sends for `/`, scripts left out. */
async function serverHtml(page: Page): Promise<string> {
  const res = await page.request.get("/");
  expect(res.status()).toBe(200);
  return (await res.text()).replace(/<script[\s\S]*?<\/script>/g, "");
}

async function writeDraft(page: Page) {
  await openStudio(page);
  await patchThroughStore(page, "/src/content/site.val.ts", [
    { op: "replace", path: ["tagline"], value: DRAFT },
  ]);
}

test.describe("a draft page, as the server renders it", () => {
  test("in preview, the server sends the draft, tagged for editing", async ({
    page,
  }) => {
    await writeDraft(page);
    await page.goto("/api/val/enable?redirect_to=/");

    // Polled: the write is saved to the server asynchronously.
    await expect
      .poll(() => serverHtml(page), { timeout: 20_000 })
      .toContain(DRAFT);
    const html = await serverHtml(page);
    expect(html).not.toContain(PUBLISHED);
    expect(html).toMatch(STEGA);
  });

  test("and the browser hydrates it without changing it", async ({ page }) => {
    await writeDraft(page);
    await page.goto("/api/val/enable?redirect_to=/");
    await expect
      .poll(() => serverHtml(page), { timeout: 20_000 })
      .toContain(DRAFT);

    const logged: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") logged.push(message.text());
    });
    /*
     * What the page shows from first paint to settled, sampled: the published
     * text must never be on screen, at any point.
     */
    const seen = new Set<string>();
    await page.goto("/", { waitUntil: "commit" });
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      const text = await page
        .evaluate(() => document.body?.innerText ?? "")
        .catch(() => "");
      if (text.includes(PUBLISHED)) seen.add("published");
      if (text.includes(DRAFT)) seen.add("draft");
      await page.waitForTimeout(50);
    }
    expect([...seen]).toEqual(["draft"]);
    expect(
      logged.filter((line) => /hydrat|did not match|mismatch/i.test(line)),
    ).toEqual([]);
  });

  test("a visitor gets the published page, untagged", async ({
    page,
    browser,
  }) => {
    await writeDraft(page);
    const visitor = await browser.newContext();
    try {
      const res = await visitor.request.get(
        new URL("/", page.url()).toString(),
      );
      const html = (await res.text()).replace(/<script[\s\S]*?<\/script>/g, "");
      expect(html).toContain(PUBLISHED);
      expect(html).not.toContain(DRAFT);
      expect(html).not.toMatch(STEGA);
    } finally {
      await visitor.close();
    }
  });
});
