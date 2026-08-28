import { expect, test, type Page } from "@playwright/test";
import {
  clearPatchChain,
  closeNavPanel,
  expandRow,
  openSiteMap,
} from "./studio";
import {
  observeDevReloads,
  reportTrail,
  type DevReloadObserver,
} from "./devReload";

/**
 * What reloads the Studio document in development, and what no longer does.
 *
 * The report: "sometimes the whole Next application reloads when we save",
 * narrowed over several rounds to "if I go to a new route in Val and the page
 * loads the draft mode thing again". The mechanism, measured rather than
 * reasoned about (see `devReload.ts` for the instruments and
 * `architecture/quirks.md` for the write-up):
 *
 * 1. A new same-origin Next document opens — the canvas iframe, or any iframe
 *    Val points at a route of the app.
 * 2. If `next dev` has not compiled that route yet, compiling it moves webpack's
 *    compilation hash.
 * 3. The new document's HMR client connects. `next dev` answers a connect by
 *    **broadcasting** a `sync` carrying the current hash — `publish`, not a
 *    reply to the connecting client (`next/dist/server/dev/hot-middleware.js`,
 *    `onHMR`).
 * 4. Every OTHER document gets it too. A client whose recorded hash differs
 *    concludes the dev server restarted and calls `window.location.reload()`
 *    (`next/dist/client/dev/hot-reloader/app/web-socket.js`, the `SYNC` branch).
 *    The Studio is one of those documents.
 *
 * So the Studio is reloaded by a handshake that was never meant for it. Val's
 * lever is the number of Next documents it opens: the canvas has to be one, the
 * draft-mode handshake did not — it used to load the entire `/val` route just to
 * post one message, which is what the first test here pins shut.
 *
 * `openStudio` is deliberately not used: it waits on intake, and these cases
 * need the observer installed before the very first navigation.
 */

/** Long enough for `next dev` to compile a route it has not served yet. */
const COMPILE_TIMEOUT = 60_000;

/** Open the Studio with the observer already attached. */
async function openObservedStudio(
  page: Page,
  route = "/val",
): Promise<DevReloadObserver> {
  const observer = await observeDevReloads(page);
  await page.goto(route);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const bag = window as unknown as {
            __VAL_STORES__?: { received: boolean };
          };
          return bag.__VAL_STORES__?.received === true;
        }),
      {
        timeout: COMPILE_TIMEOUT,
        message: "the store system never took the project in",
      },
    )
    .toBe(true);
  return observer;
}

/**
 * Open the canvas on the page the site map's `blogs/blog1` row selects, WITH
 * preview mode on.
 *
 * Turning preview on is not decoration here: the draft-mode machinery this file
 * is about is gated on the page mounting Val's client code, which needs the Val
 * Enable cookie. Without it the canvas comes up blocked, no draft-mode iframe is
 * ever opened, and a test that meant to measure that iframe measures nothing —
 * and passes either way.
 */
async function openCanvasOnBlog1(page: Page) {
  const studio = await openSiteMap(page);
  await expandRow(studio, "blogs");
  await expandRow(studio, "blog1");
  await closeNavPanel(studio, "Pages");
  await studio
    .getByRole("button", { name: /Open the canvas|^Canvas$/ })
    .click();
  const route = studio.getByLabel("Canvas route");
  await expect(route).toHaveValue("/blogs/blog1", { timeout: COMPILE_TIMEOUT });

  const turnOn = studio.getByRole("button", { name: "Turn on preview mode" });
  if (await turnOn.isVisible().catch(() => false)) {
    await turnOn.click();
    // The overlay goes when the page answers `ready` with draft mode on. It is
    // a fresh document behind a redirect through `/api/val/enable`, so this
    // waits for a load, not a re-render.
    await expect(turnOn).toBeHidden({ timeout: COMPILE_TIMEOUT });
  }
  return { studio, route };
}

/**
 * Give the dev server time to compile, broadcast, and reload.
 *
 * A fixed wait, not a condition: what is being measured is whether anything
 * happens at all, and polling for the thing would hide a late one.
 */
async function settle(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

test.describe("what reloads the studio in dev", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  test.beforeAll(async ({ request }) => {
    await clearPatchChain(request);
  });

  /**
   * The document the draft-mode handshake lands on is not a Next route.
   *
   * This is the fix. Turning draft mode on happens server-side, so Val points a
   * hidden iframe at `/api/val/draft/enable`, and something has to load
   * afterwards and post `val-ready` back. That used to be
   * `/val?message_onready=true` — the whole Studio route, React tree and SPA
   * script, to send one message. Being a Next document it connected an HMR
   * client, and by the chain at the top of this file a new client connecting
   * reloads every other document whose compilation hash has moved since — after
   * a save, say, which rewrites the `.val.ts` files.
   *
   * Asserted at the endpoint rather than through the UI: the iframe is opened
   * only when the on-page overlay toggles draft mode, which nothing in this
   * suite drives. What is checkable here is that the document Val now points at
   * exists, announces itself, and carries no Next client bundle — which is the
   * property that keeps it out of the HMR broadcast.
   */
  test("the draft-mode handshake lands on a document with no next client", async ({
    request,
  }) => {
    const res = await request.get("/api/val/draft/ready");
    expect(res.status(), "the ready document was not served").toBe(200);
    expect(res.headers()["content-type"]).toContain("text/html");

    const body = await res.text();
    expect(
      body,
      "the ready document does not announce itself, so the provider would " +
        "never take its iframe down",
    ).toContain("val-ready");
    // The property that matters: no Next bundle, so no HMR client, so no
    // `sync` broadcast when it loads.
    expect(
      body,
      "the ready document pulls in Next's client bundle, which is the thing " +
        "that made loading /val reload the studio",
    ).not.toContain("/_next/");
  });

  /**
   * A canvas navigation to a route already served leaves the Studio alone.
   *
   * The control that makes the pinned case below mean something: it is the FIRST
   * compile that moves the hash, so a second visit broadcasts a `sync` the
   * Studio already agrees with.
   */
  test("a canvas navigation to an already-served route leaves the studio alone", async ({
    page,
  }) => {
    const observer = await openObservedStudio(page);
    const { route } = await openCanvasOnBlog1(page);

    // Serve it once so it is compiled, then come back to it.
    await route.fill("/support/getting-started");
    await route.press("Enter");
    await settle(page, 15_000);
    await route.fill("/blogs/blog1");
    await route.press("Enter");
    await settle(page, 5_000);

    const before = await observer.stamp();
    observer.reset();
    await route.fill("/support/getting-started");
    await route.press("Enter");
    await settle(page, 10_000);

    expect(
      await observer.stamp(),
      "the studio document was replaced by a navigation to a route the dev " +
        "server had already compiled\n" +
        observer.report("second visit"),
    ).toBe(before);
  });

  /**
   * Navigating the Studio itself, with no canvas, leaves it alone.
   *
   * Isolates the Studio's own router from the canvas. The Studio pushes deep
   * URLs through `history.pushState`, which Next intercepts and turns into a
   * router restore; this says that is not what replaces the document.
   */
  test("a studio navigation with no canvas leaves the studio alone", async ({
    page,
  }) => {
    const observer = await openObservedStudio(page);
    const studio = await openSiteMap(page);
    await expandRow(studio, "blogs");
    await expandRow(studio, "blog1");
    await expect(studio.locator("input").first()).toHaveValue("Blog 1", {
      timeout: COMPILE_TIMEOUT,
    });

    const before = await observer.stamp();
    observer.reset();
    // A module never opened in this session, so the Studio's own route changes
    // and its editor mounts for the first time — but no app route is requested.
    await expandRow(studio, "support");
    await expandRow(studio, "getting-started");
    await closeNavPanel(studio, "Pages");
    await settle(page, 15_000);

    expect(
      await observer.stamp(),
      "the studio document was replaced by its own navigation, with no canvas " +
        "open\n" +
        observer.report("studio navigation"),
    ).toBe(before);
  });

  /**
   * Editing with the canvas open on a served route leaves the Studio alone.
   *
   * The case an editor spends all day in, and the one the report said was fine.
   * A save rewrites the `.val.ts` files, which moves the compilation hash — so
   * this also guards the fix above: with the draft-mode iframe no longer loading
   * a Next document, a moved hash has no new client to be broadcast at.
   */
  test("an edit with the canvas open leaves the studio alone", async ({
    page,
    request,
  }) => {
    const observer = await openObservedStudio(page);
    const { studio } = await openCanvasOnBlog1(page);

    const before = await observer.stamp();
    observer.reset();
    await studio.locator("input").first().fill("Blog 1 measured");
    await settle(page, 12_000);

    const after = await observer.stamp();
    const report = observer.report("an edit");
    // Restored before the assertion, so a failure does not leave the fixture
    // edited for every suite that reads it.
    await clearPatchChain(request);
    expect(
      after,
      "the studio document was replaced by an edit on an already-served " +
        "route\n" +
        report,
    ).toBe(before);
  });

  /**
   * PINNED, and not Val's to fix: a canvas navigation to a route `next dev` has
   * not compiled yet DOES reload the Studio.
   *
   * Asserted as it is rather than left out, because it is the last piece of the
   * report still standing and someone will otherwise spend an afternoon
   * re-deriving it. The chain is at the top of this file; the part that makes it
   * Next's is `onHMR` using `publish` — a per-client handshake sent to every
   * client — so a document that only ever loaded the Studio is reloaded by
   * another document's connect.
   *
   * Val cannot avoid it from the client side: the canvas has to be a document of
   * the app, that document has to connect an HMR client, and the first broadcast
   * after any hash movement reloads every client whose hash is older. The ways
   * out are upstream (answer a connect on that client's socket only) or
   * structural (the Studio not being a route of the app it edits).
   *
   * When this test starts FAILING, that has happened: delete it, and the
   * `architecture/quirks.md` entry with it.
   */
  test("PINNED (next dev): a canvas navigation to an uncompiled route reloads the studio", async ({
    page,
  }) => {
    const observer = await openObservedStudio(page);
    const { route } = await openCanvasOnBlog1(page);

    const before = await observer.stamp();
    observer.reset();
    // `/notes/first` rather than a `.val.json`-backed route: the report named
    // one, but it is the first compile that matters, not what the content is.
    await route.fill("/notes/first");
    await route.press("Enter");
    await settle(page, 15_000);

    const after = await observer.stamp();
    const report =
      observer.report("uncompiled route") +
      "\n" +
      reportTrail(await observer.trail());
    expect(
      after,
      "the studio document SURVIVED a canvas navigation to an uncompiled " +
        "route. If Next fixed the broadcast, delete this test and the " +
        "quirks.md entry; if a Val change did it, that is the reload gone.\n" +
        report,
    ).not.toBe(before);
  });
});
