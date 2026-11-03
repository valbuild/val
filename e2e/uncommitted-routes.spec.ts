import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  clearPatchChain,
  closeNavPanel,
  openNavPanel,
  openStudio,
} from "./studio";
import { NEXT_APP_URL, TANSTACK_APP_URL } from "./apps";

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
async function enablePreview(
  page: Page,
  appUrl: string = TANSTACK_APP_URL,
): Promise<void> {
  const enabling = await page.context().newPage();
  await enabling.goto(
    "/api/val/enable?redirect_to=" +
      encodeURIComponent(`${appUrl}/blogs/blog1`),
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
  }) => {
    await clearPatchChain(request);
    await enablePreview(page);
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
   * `/generic/[[..._splat]]` reads ONLY its own module — the one with the patch —
   * so the store has everything it needs on the first render and nothing forces
   * it to suspend. That is what exposes the `draftMode === null` race: the
   * render goes straight through while draft mode is still unknown, the content
   * reader treats unknown as off, the route resolves against committed source,
   * and `notFound()` is called before the answer arrives. `/blogs` hides this,
   * because the unedited authors module makes it suspend long enough for draft
   * mode to become known — which is why the fix and its test have to be
   * separate things.
   *
   * It was `test.fixme`, because `notFound()` is called on the FIRST render —
   * the server's, and the hydration render after it — before any gate the
   * browser switches on can be consulted. What closes it is the server
   * rendering the draft: the layout reads the request's draft and hands it to
   * `<ValProvider draft>`, so the store is full before the first render
   * (`fetchValDraft`: TanStack's in `_site.tsx`'s loader, Next's from
   * `initValRsc` in the root layout). See architecture/quirks.md, wait 3 of
   * "`suspend` is three waits, and a route only gets one chance". Next's copy
   * of the case is below.
   */
  test("renders a route whose module is the only one it reads", async ({
    page,
    request,
  }) => {
    await singleModuleRoute(page, request, {
      appUrl: TANSTACK_APP_URL,
      route: "/generic/[[..._splat]]",
      param: "_splat",
    });
  });

  test("renders in the canvas from a server component", async ({
    page,
    request,
  }) => {
    await clearPatchChain(request);
    await enablePreview(page);
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

/**
 * The single-module case, on `examples/next`: a CLIENT component
 * (`useValRoute`) whose route exists only in a patch, under a root layout that
 * passes `fetchValDraft()` from `initValRsc` to `<ValProvider draft>`. Without
 * that, the server render resolves against committed source and calls
 * `notFound()`, which nothing later can undo.
 */
test.describe("a route that has not been committed, on Next", () => {
  test.use({ baseURL: NEXT_APP_URL });

  test("renders a route whose module is the only one it reads", async ({
    page,
    request,
  }) => {
    await singleModuleRoute(page, request, {
      appUrl: NEXT_APP_URL,
      route: "/generic/[[...path]]",
      param: "path",
    });
  });
});

/** Make a page under a route whose module is the only one its page reads, and look at it. */
async function singleModuleRoute(
  page: Page,
  request: APIRequestContext,
  app: { appUrl: string; route: string; param: string },
): Promise<void> {
  await clearPatchChain(request);
  await enablePreview(page, app.appUrl);
  await openStudio(page);
  const studio = page.locator("#val-shadow-root");
  await createPage(page, studio, app.route, app.param, "uncommitted");
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
}
