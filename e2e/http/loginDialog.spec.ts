import { devices, expect, test, type Page } from "@playwright/test";
import { mock } from "./httpMode";

/**
 * Signed out, the Studio is one dialog with one link: "Log in".
 *
 * It is the only way in, so it is the one thing on the page that has to be
 * reachable. It once was not: `LoginDialog` wrapped `DialogContent` in a
 * portal and overlay of its own, while `DialogContent` already renders both.
 * The extra overlay went to `document.body`, outside the Studio's shadow
 * root, where a site with Tailwind of its own (as most of ours have) styled it
 * `fixed inset-0 z-50` and laid it over the whole Studio. On a phone nobody
 * could sign in at all: the tap landed on the overlay.
 *
 * Asserted with `elementFromPoint` as well as with a tap, because a tap that
 * lands on the wrong element fails with a timeout that says nothing about why.
 *
 * Proxy mode, because signing in is something only proxy mode has: fs mode is
 * a developer's own laptop and is never signed out.
 */

/** Whether the element at the link's centre is the link, or inside it. */
async function linkIsOnTop(page: Page): Promise<boolean> {
  const link = page.getByRole("link", { name: "Log in" });
  return link.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    // The link is inside the Studio's shadow root, so the document's answer
    // stops at the shadow host: ask the root the link lives in.
    const root = el.getRootNode();
    const top =
      root instanceof ShadowRoot
        ? root.elementFromPoint(x, y)
        : document.elementFromPoint(x, y);
    return (
      top !== null &&
      (top === el || el.contains(top)) &&
      // ...and nothing in the light DOM is over the shadow host either.
      (root instanceof ShadowRoot
        ? document.elementFromPoint(x, y) === root.host ||
          root.host.contains(document.elementFromPoint(x, y))
        : true)
    );
  });
}

/**
 * The utility classes a site built with Tailwind has in its own stylesheet.
 *
 * `examples/tanstack` has no Tailwind, so an element the Studio leaks into the
 * site's DOM with Tailwind classes on it is unstyled there, and harmless. On
 * the site where this was found it is a full-screen layer over everything.
 */
const SITE_TAILWIND = `
  .fixed { position: fixed; }
  .inset-0 { inset: 0; }
  .z-50 { z-index: 50; }
`;

async function openSignedOut(page: Page): Promise<void> {
  await page.goto("/val");
  await page.addStyleTag({ content: SITE_TAILWIND });
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible({
    timeout: 60_000,
  });
}

async function expectOneOverlay(page: Page): Promise<void> {
  // One dimmed backdrop, in the Studio, and none in the site's own DOM.
  await expect(
    page.locator("body > [data-state='open'].fixed.inset-0"),
  ).toHaveCount(0);
}

test.beforeEach(async () => {
  await mock.reset();
});

test.describe("signed out, on a phone", () => {
  // `defaultBrowserType` names WebKit, and the project picks the browser.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...iPhone } = devices["iPhone 13"];
  test.use(iPhone);

  test("the Log in link can be tapped", async ({ page }) => {
    await openSignedOut(page);
    const link = page.getByRole("link", { name: "Log in" });
    await expectOneOverlay(page);
    expect(await linkIsOnTop(page)).toBe(true);

    const authorize = page.waitForRequest((req) =>
      req.url().includes("/api/val/authorize"),
    );
    await link.tap();
    expect(
      new URL((await authorize).url()).searchParams.get("redirect_to"),
    ).toContain("/val");
  });
});

test.describe("signed out, on a desktop", () => {
  test("the Log in link can be clicked", async ({ page }) => {
    await openSignedOut(page);
    const link = page.getByRole("link", { name: "Log in" });
    await expectOneOverlay(page);
    expect(await linkIsOnTop(page)).toBe(true);

    const authorize = page.waitForRequest((req) =>
      req.url().includes("/api/val/authorize"),
    );
    await link.click();
    await authorize;
  });
});

test.describe("signed out, the Studio stops asking", () => {
  /**
   * Once a 401 has said the person is signed out, asking again cannot give a
   * different answer until they sign in -- which reloads the page. The tab
   * sitting on the login dialog used to ask `/remote/settings` again every
   * five seconds regardless (`shouldRetryRemoteSettings`).
   */
  test("no request is repeated while the login dialog is up", async ({
    page,
  }) => {
    const unauthorized: string[] = [];
    page.on("response", (res) => {
      if (res.status() === 401) unauthorized.push(new URL(res.url()).pathname);
    });
    await openSignedOut(page);
    const before = unauthorized.length;
    // Longer than the five seconds the retry used to wait, twice over.
    await page.waitForTimeout(12_000);
    expect(unauthorized.slice(before)).toEqual([]);
  });
});
