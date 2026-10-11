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
 *
 * The tagline on that page is rendered by a LAZY child handed it as a prop,
 * which hydrates after the component that read it: the case where a draft
 * page's server HTML and its hydration have to agree however late a part of
 * the page hydrates.
 */

const DRAFT = "Rendered as the draft, on the server";
const PUBLISHED = "Content as code, in a TanStack Start app.";
/** The zero-width characters Val's edit tags are written in. */
const STEGA = new RegExp("[\\u200B-\\u200D\\uFEFF\\u2060-\\u2064]");

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
  test("in preview, the server sends the draft", async ({ page }) => {
    await writeDraft(page);
    await page.goto("/api/val/enable?redirect_to=/");

    // Polled: the write is saved to the server asynchronously.
    await expect
      .poll(() => serverHtml(page), { timeout: 20_000 })
      .toContain(DRAFT);
    // The text only: its edit tags come with the render after hydration, so
    // that what is hydrated is exactly what the server sent.
    expect(await serverHtml(page)).not.toContain(PUBLISHED);
  });

  test("and the browser hydrates it without changing it", async ({ page }) => {
    await writeDraft(page);
    await page.goto("/api/val/enable?redirect_to=/");
    await expect
      .poll(() => serverHtml(page), { timeout: 20_000 })
      .toContain(DRAFT);

    /*
     * React reports a hydration mismatch as an uncaught error, not always as a
     * console line -- the dev server's client intercepts it -- so both.
     */
    const logged: string[] = [];
    page.on("console", (message) => logged.push(message.text()));
    page.on("pageerror", (error) => logged.push(error.message));
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
    // And it ends up click-to-editable: tagged once the page has hydrated.
    await expect
      .poll(
        () =>
          page
            .locator('[data-val-path*="/src/content/site.val.ts"]')
            .first()
            .textContent()
            .catch(() => null),
        { timeout: 15_000 },
      )
      .toContain(DRAFT);
    expect(
      logged.filter((line) => /hydrat|did not match|mismatch/i.test(line)),
    ).toEqual([]);
  });

  test("a `.jsonValues()` entry the draft edits is in the server's HTML too", async ({
    page,
  }) => {
    /*
     * `/sources/~` keeps each entry of such a module as a marker -- its
     * content lives in its own file -- so the draft has to carry the edited
     * entries' content, or the page rendered the published entry first.
     */
    const ENTRY_DRAFT = "What is Val, as a draft?";
    await openStudio(page);
    await patchThroughStore(page, "/src/content/kb.val.ts", [
      { op: "replace", path: ["what-is-val", "title"], value: ENTRY_DRAFT },
    ]);
    await page.goto("/api/val/enable?redirect_to=/showcase");
    const showcase = async () => {
      const res = await page.request.get("/showcase");
      return (await res.text()).replace(/<script[\s\S]*?<\/script>/g, "");
    };
    await expect.poll(showcase, { timeout: 20_000 }).toContain(ENTRY_DRAFT);
    expect(await showcase()).not.toContain("What is Val?<");

    // And the browser hydrates the entry from the same draft.
    const logged: string[] = [];
    page.on("console", (message) => logged.push(message.text()));
    page.on("pageerror", (error) => logged.push(error.message));
    await page.goto("/showcase");
    await expect
      .poll(
        () =>
          page
            .locator('[data-val-path*="/src/content/kb.val.ts"]')
            .filter({ hasText: ENTRY_DRAFT })
            .count(),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
    expect(
      logged.filter((line) =>
        /hydrat|did not match|mismatch|Seroval/i.test(line),
      ),
    ).toEqual([]);
  });

  test("a `.jsonValues()` entry the draft renames is in the server's HTML too", async ({
    page,
  }) => {
    /*
     * A rename is a whole-entry `move`: the new key's content is the old
     * key's, which lives in another file. Read on its own, the new key had
     * nothing to replay onto, so the module was left out of the draft.
     */
    await openStudio(page);
    await patchThroughStore(page, "/src/content/kb.val.ts", [
      { op: "move", from: ["what-is-val"], path: ["what-is-val-renamed"] },
    ]);
    await page.goto("/api/val/enable?redirect_to=/showcase");
    await expect
      .poll(
        async () => {
          const res = await page.request.get("/showcase");
          return (await res.text())
            .replace(/<script[\s\S]*?<\/script>/g, "")
            .replace(new RegExp(STEGA.source, "g"), "");
        },
        { timeout: 20_000 },
      )
      .toContain("<strong>What is Val?</strong>");
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
