import { expect, test, type Page } from "@playwright/test";
import { mock, openHttpStudio, sessionCookie } from "./httpMode";

/**
 * A new build's code, into an open Studio (`BuildCode`, phase 9 of
 * `docs/plans/one-content-model.md`): what replaced the one-way "A new
 * version has been deployed" dialog.
 *
 * `buildCode.test.ts` has the rules at the store level, and the scenarios
 * (`codeChanges.scenario.test.ts`, S16) a build's registry taken in place.
 * This is the wiring -- the manifest through `ValStoreProvider` to
 * `ManifestSource` and `BuildCode`, and the page reloaded by the browser --
 * and the one fact no unit test can establish: that the schema versions the
 * BROWSER bundle computes are the ones the SERVER's Node bundle names on its
 * manifest. If those disagreed, the Studio would never know when it runs the
 * server's code, and a deploy would go unnoticed.
 *
 * "A new schema" is made by rewriting the manifest's schema versions,
 * because the harness runs one build for the whole run. This app names no
 * registry (the platform did not build it, as with any self-hosted deploy),
 * so the Studio takes the new code by reloading its page.
 */

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.beforeEach(async () => {
  await mock.reset();
});

/** The schema version the Studio runs each module of `paths` with. */
function runningSchemas(
  page: Page,
  paths: string[],
): Promise<Record<string, unknown>> {
  return page.evaluate((paths) => {
    const stores: unknown = Reflect.get(window, "__VAL_STORES__");
    const system: unknown = Reflect.get(Object(stores), "system");
    const sourceStore: unknown = Reflect.get(Object(system), "sourceStore");
    const of: unknown = Reflect.get(
      Object(sourceStore),
      "schemaVersionOfModule",
    );
    if (typeof of !== "function") throw new Error("no schemaVersionOfModule");
    return Object.fromEntries(
      paths.map((path) => [path, of.call(sourceStore, path)]),
    );
  }, paths);
}

function manifestModules(json: unknown): Record<string, { schema: string }> {
  return Object(Reflect.get(Object(json), "modules"));
}

test("the page's schema versions are the server's", async ({ page }) => {
  const served = page
    .waitForResponse(
      (res) =>
        res.request().method() === "GET" &&
        new URL(res.url()).pathname === "/api/val/manifest" &&
        res.status() === 200,
    )
    .then(async (res) => manifestModules(await res.json()));

  await openHttpStudio(page);
  const modules = await served;
  const paths = Object.keys(modules);
  expect(paths.length).toBeGreaterThan(0);
  expect(await runningSchemas(page, paths)).toEqual(
    Object.fromEntries(paths.map((path) => [path, modules[path].schema])),
  );
  // And no registry: this app was not built by the platform.
});

test("a deploy the Studio cannot take in place reloads the page, with nothing to click", async ({
  page,
}) => {
  let deployed = false;
  await page.route("**/api/val/manifest**", async (route) => {
    // Once "deployed", always the whole answer: the Studio's ETag names a
    // manifest the newer build would not have answered.
    const headers = { ...route.request().headers() };
    if (deployed) delete headers["if-none-match"];
    const response = await route.fetch({ headers });
    if (!deployed || response.status() !== 200) {
      return route.fulfill({ response });
    }
    const json: unknown = await response.json();
    const modules = manifestModules(json);
    const [first] = Object.keys(modules);
    await route.fulfill({
      response,
      json: {
        ...Object(json),
        modules: {
          ...modules,
          [first]: { ...modules[first], schema: "the-schema-of-a-newer-build" },
        },
      },
    });
  });
  // The Studio and the server agree first: only then is a reload a fix.
  const agreed = page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname === "/api/val/manifest" &&
      res.status() === 200,
  );
  await openHttpStudio(page);
  await agreed;
  const studio = page.locator("#val-shadow-root");

  const reloaded = page.waitForEvent("framenavigated", {
    predicate: (frame) => frame === page.mainFrame(),
    timeout: 60_000,
  });
  deployed = true;
  // What the canvas does when a page of a newer build loads in it: read the
  // manifest now (`checkCodeNow`), rather than at the next `/stat`.
  await page.evaluate(() => {
    const stores: unknown = Reflect.get(window, "__VAL_STORES__");
    const system: unknown = Reflect.get(Object(stores), "system");
    const check: unknown = Reflect.get(Object(system), "checkCodeNow");
    if (typeof check !== "function") throw new Error("no checkCodeNow");
    check.call(system);
  });
  await reloaded;
  await expect(studio.getByText("A new version has been deployed")).toHaveCount(
    0,
  );
});
