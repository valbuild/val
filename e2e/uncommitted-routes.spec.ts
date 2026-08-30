import { expect, type Locator, type Page } from "@playwright/test";
import {
  clearPatchChain,
  closeNavPanel,
  openNavPanel,
  openStudio,
  test,
} from "./studio";

/**
 * A page that exists only in an uncommitted patch.
 *
 * The thing an editor does first: make a page, look at it. It went to a 404 —
 * and `suspend` on `ValProvider` is exactly the machinery meant to stop that,
 * so the failure looked like the feature had never worked.
 *
 * Two bugs, in the two halves of the wait:
 *
 * 1. `draftMode` starts `null`, meaning "/draft/stat has not answered". The
 *    reader that turns a selector into content treats `null` as off, so a render
 *    that got through while it was unknown resolved against COMMITTED source —
 *    and for a route that only exists in a patch that is `notFound()`, which no
 *    later answer can undo. The gate now waits for the answer first.
 *
 * 2. The editor only sends draft sources for modules it has patches for, because
 *    an unedited module has no draft to send. The page could not tell "not sent
 *    yet" from "nothing to send", so it waited out its own ten second timeout
 *    once per unedited module it reads — `/blogs/[blog]` also reads the authors
 *    module — and sat on its loading fallback long enough to look broken. The
 *    editor now says when it has sent everything it holds.
 *
 * Both kinds of route are checked: `/blogs/[blog]` is a plain router read by a
 * CLIENT component (`useValRoute`, where suspend lives) and `/notes/[note]` is a
 * plain router read by a SERVER component (`fetchValRoute`, which resolves
 * against patches the server reads itself). `fetchValRoute` takes a different
 * path again for a `.jsonValues()` router, so `/notes` exists specifically to
 * cover the plain one.
 */

/** Make a page under one route. */
async function createPage(
  page: Page,
  studio: Locator,
  route: string,
  paramPlaceholder: string,
  key: string,
): Promise<void> {
  const pages = await openNavPanel(page, "Pages");
  await pages.getByRole("button", { name: "New page" }).click();
  const routeSelect = pages.getByLabel("Route");
  if (await routeSelect.count()) {
    await routeSelect.selectOption({ label: route });
  }
  await pages.locator(`input[placeholder="${paramPlaceholder}"]`).fill(key);
  await pages.getByRole("button", { name: "Create" }).click();
  await closeNavPanel(studio, "Pages");
}

/**
 * Turn preview mode on for the whole browser context, before anything loads.
 *
 * Through the endpoint the canvas's own button uses, rather than the button:
 * the button only appears once the page has reported that it is NOT in draft
 * mode, and a page that 404s reports nothing at all — so waiting for it makes
 * the test's own precondition depend on the bug it is testing. This sets the
 * Val Enable cookie and draft mode, which is the state an editor is in by the
 * time they create a page.
 */
async function enablePreview(page: Page, baseURL: string): Promise<void> {
  const enabling = await page.context().newPage();
  // `redirect_to` is followed by the browser, so it has to be absolute AND has
  // to name THIS worker's app. It used to be hardcoded to `localhost:3456`,
  // the port of the single shared dev server; with an app per worker that URL
  // belongs to nothing and the redirect lands on a refused connection.
  await enabling.goto(
    "/api/val/enable?redirect_to=" +
      encodeURIComponent(`${baseURL}/blogs/blog1`),
  );
  await expect
    .poll(
      () =>
        enabling.evaluate(async () =>
          (await fetch("/api/val/draft/stat")).text(),
        ),
      { message: "preview mode never came on" },
    )
    .toContain('"draftMode":true');
  await enabling.close();
}

/** The canvas frame showing this route, once it has one. */
function canvasFrame(page: Page, urlPart: string) {
  return page
    .frames()
    .find(
      (frame) =>
        frame.url().includes(urlPart) && !frame.url().includes("/val/~"),
    );
}

/**
 * What the canvas frame for this route currently shows.
 *
 * Empty when there is no frame yet — and the assertions below are all POSITIVE
 * for that reason. A `not.toContain` here passes on an empty string, so the
 * first version of this test passed without any of the fixes: no frame, no 404
 * text, no loading text, nothing proved.
 */
async function frameText(page: Page, urlPart: string): Promise<string> {
  const frame = canvasFrame(page, urlPart);
  if (!frame) return "";
  return frame
    .locator("body")
    .innerText()
    .catch(() => "");
}

/**
 * Give the new page a title, so there is something to look for.
 *
 * A page created from `emptyOf(schema.item)` has empty fields, and "the canvas
 * is not showing a 404" is not something an empty page can demonstrate — it
 * looks the same as a canvas that has not loaded. Typing a title makes the
 * assertion positive: this text can only be on screen if the page resolved the
 * route from an uncommitted patch AND rendered its draft content.
 */
async function setTitle(studio: Locator, title: string): Promise<void> {
  const input = studio.locator("input").first();
  await expect(input).toBeVisible({ timeout: 30000 });
  await input.fill(title);
}

test.describe("a route that has not been committed", () => {
  test("renders in the canvas from a client component", async ({
    page,
    request,
    workerApp,
  }) => {
    await clearPatchChain(request);
    await enablePreview(page, workerApp.baseURL);
    await openStudio(page);
    const studio = page.locator("#val-shadow-root");
    await createPage(page, studio, "/blogs/[blog]", "blog", "uncommitted");
    await setTitle(studio, "Uncommitted client page");

    await studio.getByRole("button", { name: /Open the canvas/ }).click();
    await expect(studio.getByLabel("Canvas route")).toHaveValue(
      "/blogs/uncommitted",
      { timeout: 30000 },
    );

    await expect
      .poll(() => frameText(page, "/blogs/uncommitted"), {
        message:
          "the uncommitted route never rendered its draft content in the canvas",
        timeout: 60000,
      })
      .toContain("Uncommitted client page");
    await clearPatchChain(request);
  });

  /**
   * The case that pins the 404 rather than the stall.
   *
   * `/generic/[[...path]]` reads ONLY its own module — the one with the patch —
   * so the store has everything it needs on the first render and nothing forces
   * it to suspend. That is what exposes the `draftMode === null` race: the
   * render goes straight through while draft mode is still unknown, the content
   * reader treats unknown as off, the route resolves against committed source,
   * and `notFound()` is called before the answer arrives. `/blogs` hides this,
   * because the unedited authors module makes it suspend long enough for draft
   * mode to become known — which is why the fix and its test have to be
   * separate things.
   */
  /**
   * KNOWN FAILING — the fix needs a decision that is not mine to make.
   *
   * `notFound()` is called on the FIRST render, and the suspend gate is switched
   * on by an effect, which runs after it. So this render resolves against
   * committed source no matter what the gate would have decided: the route is
   * absent, `notFound()` is terminal, and nothing later gets a turn. The
   * `draftMode === null` fix cannot help, because the gate is not consulted at
   * all.
   *
   * Closing it means the FIRST render knowing that Val is enabled — which is
   * what `suspend={await isValEnabled()}` did before a4c09b2e. TRIED, and it is
   * not enough on its own: with the gate on during SSR the server suspends on
   * `waitForLoad`, and the store it is waiting for is only ever filled from the
   * browser, so the request hangs rather than 404s. Making it work needs the
   * server able to supply draft sources during its own render, which is a good
   * deal more than a prop. See architecture/quirks.md.
   */
  test.fixme("renders a route whose module is the only one it reads", async ({
    page,
    request,
    workerApp,
  }) => {
    await clearPatchChain(request);
    await enablePreview(page, workerApp.baseURL);
    await openStudio(page);
    const studio = page.locator("#val-shadow-root");
    await createPage(
      page,
      studio,
      "/generic/[[...path]]",
      "path",
      "uncommitted",
    );
    await setTitle(studio, "Uncommitted single module");

    await studio.getByRole("button", { name: /Open the canvas/ }).click();
    await expect(studio.getByLabel("Canvas route")).toHaveValue(
      "/generic/uncommitted",
      { timeout: 30000 },
    );

    await expect
      .poll(() => frameText(page, "/generic/uncommitted"), {
        message: "the route resolved against committed source and 404ed",
        timeout: 60000,
      })
      .toContain("Uncommitted single module");
    await clearPatchChain(request);
  });

  test("renders in the canvas from a server component", async ({
    page,
    request,
    workerApp,
  }) => {
    await clearPatchChain(request);
    await enablePreview(page, workerApp.baseURL);
    await openStudio(page);
    const studio = page.locator("#val-shadow-root");
    await createPage(page, studio, "/notes/[note]", "note", "uncommitted");
    await setTitle(studio, "Uncommitted server page");

    await studio.getByRole("button", { name: /Open the canvas/ }).click();
    await expect(studio.getByLabel("Canvas route")).toHaveValue(
      "/notes/uncommitted",
      { timeout: 30000 },
    );

    // `fetchValRoute` resolves on the server, against the patches the server
    // reads itself — so this also proves the server side sees an uncommitted
    // route, which no amount of client-side suspending would give it.
    await expect
      .poll(() => frameText(page, "/notes/uncommitted"), {
        message: "the server component never saw the uncommitted route",
        timeout: 60000,
      })
      .toContain("Uncommitted server page");
    await clearPatchChain(request);
  });
});
