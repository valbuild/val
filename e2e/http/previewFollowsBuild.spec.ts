import { expect, test, type Frame, type Page } from "@playwright/test";
import { mock, openHttpStudio, sessionCookie, writePatch } from "./httpMode";

/**
 * The preview follows the code and the content, without the Studio reloading.
 *
 * The canvas is the one preview in every mode -- the content editor, code
 * mode, the Sketchpad -- so it is what has to keep up when either moves:
 *
 * - **Content**: an edit reaches the page in the frame as it is made
 *   (`CanvasFrame`'s relay), with no new document.
 * - **Code**: when the server serves ANOTHER build, the page in the frame is
 *   the old build's document until it is loaded again. The canvas loads it
 *   again (`ManifestSource.servedBuild` -> `useBuildEpoch` -> `documentKey`),
 *   whoever built it, and the Studio around it stays where it is.
 *
 * "Another build" is made the way `buildCode.spec.ts` makes "a new schema":
 * by rewriting the manifest in the browser, because the harness runs one
 * build for the whole run and this app is not one the platform built (it
 * names no registry). The manifest is given a registry entry, as a platform
 * build's has, and the test moves it. No schema moves with it, so the Studio
 * takes no code of its own (`BuildCode`): only the page has to change.
 */

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.beforeEach(async () => {
  await mock.reset();
});

/** The Studio on the home page, with the canvas open. */
const STUDIO_ON_HOME =
  "/val/~/src/routes/_site.index.val.ts?p=%22%2F%22&canvas=1";
const MODULE = "/src/routes/_site.index.val.ts";

/** The canvas's frame: the page it loads carries `val_canvas=1`. */
function canvasFrame(page: Page): Frame | undefined {
  return page
    .frames()
    .find((frame) =>
      new URL(frame.url(), "http://x").searchParams.has("val_canvas"),
    );
}

/**
 * The canvas is live: the notice above it, which goes away only once the page
 * has told the Studio it is there and in preview mode, has nothing to say.
 */
async function expectCanvasLive(page: Page): Promise<void> {
  await expect(
    page
      .locator("#val-shadow-root")
      .getByRole("status")
      .filter({ hasText: /preview|no answer/i }),
    "the canvas never went live",
  ).toHaveCount(0, { timeout: 60_000 });
}

/** Mark the document the canvas holds now, to tell it from a later one. */
async function markCanvasDocument(page: Page): Promise<void> {
  const frame = canvasFrame(page);
  if (frame === undefined) throw new Error("no canvas frame");
  await frame.evaluate(() => {
    Reflect.set(window, "__e2eDocument", "marked");
  });
}

/**
 * Whether the canvas still holds the document {@link markCanvasDocument}
 * marked: `"marked"`, or `"new"` once it holds another one.
 */
async function canvasDocument(page: Page): Promise<string> {
  const frame = canvasFrame(page);
  if (frame === undefined) return "none";
  try {
    const mark = await frame.evaluate(() =>
      Reflect.get(window, "__e2eDocument"),
    );
    return mark === "marked" ? "marked" : "new";
  } catch {
    // Detached mid-way: the frame is being replaced.
    return "none";
  }
}

/** Read the manifest now, as the canvas does when a page loads in it. */
async function checkCodeNow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const stores: unknown = Reflect.get(window, "__VAL_STORES__");
    const system: unknown = Reflect.get(Object(stores), "system");
    const check: unknown = Reflect.get(Object(system), "checkCodeNow");
    if (typeof check !== "function") throw new Error("no checkCodeNow");
    check.call(system);
  });
}

test("the preview loads the page again for a new build, and the Studio stays put", async ({
  page,
}) => {
  let build = "e2e-build-1";
  await page.route("**/api/val/manifest**", async (route) => {
    // Always the whole answer: a 304 or a delta would keep the build the
    // Studio already holds, whatever this says now.
    const url = new URL(route.request().url());
    url.searchParams.delete("since");
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const response = await route.fetch({ url: url.toString(), headers });
    if (response.status() !== 200) return route.fulfill({ response });
    const json: unknown = await response.json();
    await route.fulfill({
      response,
      json: {
        ...Object(json),
        registry: { entry: `/_app/val-modules-${build}.js`, core: "e2e" },
      },
    });
  });

  await openHttpStudio(page, STUDIO_ON_HOME);
  await expectCanvasLive(page);
  // The first build named is the one the page was loaded from: no reload.
  await checkCodeNow(page);
  await markCanvasDocument(page);
  await page.evaluate(() => Reflect.set(window, "__e2eStudio", "marked"));
  await page.waitForTimeout(2_000);
  expect(await canvasDocument(page), "a reload for the first build named").toBe(
    "marked",
  );

  // Content: the edit reaches the page, in the same document.
  const edited = `Content as code, edited ${Date.now()}`;
  await writePatch(page, MODULE, [
    { op: "replace", path: ["/", "hero", "title"], value: edited },
  ]);
  await expect(
    canvasFrame(page)!.getByRole("heading", { name: edited }),
    "the edit did not reach the page in the canvas",
  ).toBeVisible({ timeout: 30_000 });
  expect(await canvasDocument(page), "the page was reloaded for an edit").toBe(
    "marked",
  );

  // Code: another build is served, and the canvas loads the page again.
  build = "e2e-build-2";
  await checkCodeNow(page);
  await expect
    .poll(() => canvasDocument(page), {
      message: "the canvas kept the old build's page",
      timeout: 30_000,
    })
    .toBe("new");
  await expectCanvasLive(page);
  // The new document shows the content as it is, edit included.
  await expect(
    canvasFrame(page)!.getByRole("heading", { name: edited }),
  ).toBeVisible({ timeout: 30_000 });
  // And the Studio around it is the same page: nothing reloaded it.
  expect(await page.evaluate(() => Reflect.get(window, "__e2eStudio"))).toBe(
    "marked",
  );
});
