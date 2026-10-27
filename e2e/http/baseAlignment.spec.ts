import { expect, test, type Page } from "@playwright/test";
import { mock, openHttpStudio, sessionCookie, writePatch } from "./httpMode";

/**
 * The Studio shows base + chain, and both halves must come from ONE build.
 *
 * The base is the source in the bundle the Studio loaded. The chain is what
 * `/stat` announces, relative to the build that answered it. After a publish the
 * two can be different builds for a while -- the platform's pointer lags per
 * location, and a tab opened before the publish keeps its bundle -- and one
 * build's chain on another build's source loses edits or applies them twice.
 * `baseAndChain.test.ts` has every combination at the store level; this is the
 * real wiring: `/stat`'s `sourcesSha` through `ValProvider` and
 * `ValStoreProvider` to `BaseAlignment`, and the base fetched with
 * `PUT /sources/~` by the real client.
 *
 * "Another build" is made by rewriting what this app's server answers, because
 * the harness runs one build for the whole run. Its base differs from the
 * bundle's in one name, which is how the test can tell whose base is showing.
 */

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

const AUTHORS = "/content/authors.val.ts";
const OTHER_BUILD = "sources-of-another-build";
const OTHER_NAME = "Named in the other build";

function peekAuthors(page: Page): Promise<unknown> {
  return page.evaluate((path) => {
    const stores: unknown = Reflect.get(window, "__VAL_STORES__");
    const system: unknown = Reflect.get(Object(stores), "system");
    const sourceStore: unknown = Reflect.get(Object(system), "sourceStore");
    const peek: unknown = Reflect.get(Object(sourceStore), "peek");
    if (typeof peek !== "function") throw new Error("no sourceStore.peek");
    const peeked: unknown = peek.call(sourceStore, path);
    return Reflect.get(Object(peeked), "data");
  }, AUTHORS);
}

test("when the bundle's own build answers, no base is fetched", async ({
  page,
}) => {
  const baseReads: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      new URL(request.url()).pathname === "/api/val/sources/~"
    ) {
      baseReads.push(request.url());
    }
  });
  const statSha = page
    .waitForResponse(
      (res) =>
        res.request().method() === "POST" &&
        new URL(res.url()).pathname === "/api/val/stat",
    )
    .then(async (res) => Reflect.get(Object(await res.json()), "sourcesSha"));

  await openHttpStudio(page);

  // The Studio's hash of its bundle is the server's hash of its build: the
  // comparison that decides everything else is between equal things.
  const bundleSha = await page.evaluate(() => {
    const stores: unknown = Reflect.get(window, "__VAL_STORES__");
    const system: unknown = Reflect.get(Object(stores), "system");
    const host: unknown = Reflect.get(Object(system), "host");
    const bundleBase: unknown = Reflect.get(Object(host), "bundleBase");
    if (typeof bundleBase !== "function") throw new Error("no bundleBase");
    return Reflect.get(Object(bundleBase.call(host)), "sourcesSha");
  });
  expect(bundleSha).toBe(await statSha);
  // And so nothing is fetched to line them up.
  await page.waitForTimeout(2_000);
  expect(baseReads).toEqual([]);
});

test("a /stat from another build shows that build's base, with the chain on it", async ({
  page,
}) => {
  await page.route("**/api/val/stat", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const response = await route.fetch();
    const json: unknown = await response.json();
    await route.fulfill({
      response,
      json: { ...Object(json), sourcesSha: OTHER_BUILD },
    });
  });
  let baseReads = 0;
  await page.route("**/api/val/sources/~**", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    baseReads += 1;
    const response = await route.fetch();
    const json: unknown = await response.json();
    const modules: unknown = Reflect.get(Object(json), "modules");
    const authors: unknown = Reflect.get(Object(modules), AUTHORS);
    const source: unknown = Reflect.get(Object(authors), "source");
    const teddy: unknown = Reflect.get(Object(source), "teddy");
    await route.fulfill({
      response,
      json: {
        ...Object(json),
        sourcesSha: OTHER_BUILD,
        modules: {
          ...Object(modules),
          [AUTHORS]: {
            ...Object(authors),
            source: {
              ...Object(source),
              teddy: { ...Object(teddy), name: OTHER_NAME },
            },
          },
        },
      },
    });
  });

  await openHttpStudio(page);
  await expect
    .poll(() => peekAuthors(page), {
      message: "the Studio never put the other build's base in",
    })
    .toMatchObject({ teddy: { name: OTHER_NAME } });
  expect(baseReads).toBeGreaterThan(0);

  // A pending edit lands on that base, not on the bundle's.
  await writePatch(page, AUTHORS, [
    { op: "replace", path: ["freekh", "name"], value: "Pending on top" },
  ]);
  await expect
    .poll(() => peekAuthors(page))
    .toMatchObject({
      teddy: { name: OTHER_NAME },
      freekh: { name: "Pending on top" },
    });
});
