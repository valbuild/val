import { expect, test, type Page } from "@playwright/test";
import { mock, openHttpStudio, sessionCookie, writePatch } from "./httpMode";

/**
 * The Studio reads what each module IS from its server's manifest
 * (`GET /manifest`), and a module at a version it does not hold from its
 * server's module endpoint (`GET /modules/~<path>?v=`) -- phase 7 of
 * `docs/plans/one-content-model.md`. This is the real wiring: the manifest
 * through `ValStoreProvider` to `ManifestSource`, and the module read by the
 * real client.
 *
 * It replaced `BaseAlignment`, which compared `/stat`'s `sourcesSha` with the
 * bundle's and fetched another build's whole base (the whole-tree
 * `PUT /sources/~`, since removed): a version names the base it is on, per
 * module, so a base the Studio does not hold is one read of one module.
 *
 * "Another base" is made by rewriting what this app's server answers, because
 * the harness runs one build for the whole run. It differs from the bundle's
 * in one name, which is how the test can tell whose base is showing.
 */

test.use({
  storageState: { cookies: [sessionCookie("ada")], origins: [] },
});

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await mock.reset();
});

const AUTHORS = "/content/authors.val.ts";
const OTHER_BASE = "a-base-this-bundle-was-not-built-with";
const OTHER_NAME = "Named in the other base";

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

test("when the server is on the bundle's base, the manifest is read and no module is", async ({
  page,
}) => {
  const reads: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/val/manifest" || path.startsWith("/api/val/modules/")) {
      reads.push(`${request.method()} ${path}`);
    }
  });
  await openHttpStudio(page);
  await expect
    .poll(() => reads.filter((read) => read === "GET /api/val/manifest"))
    .not.toEqual([]);
  await page.waitForTimeout(2_000);
  // Every module's version is the bundle's: nothing to read.
  expect(reads.filter((read) => read !== "GET /api/val/manifest")).toEqual([]);
});

test("a manifest naming another base shows that base, with the edits on it", async ({
  page,
}) => {
  // The manifest names another base for the authors.
  let realBase: string | null = null;
  await page.route("**/api/val/manifest**", async (route) => {
    const response = await route.fetch();
    if (response.status() !== 200) return route.fulfill({ response });
    const json: unknown = await response.json();
    const modules: unknown = Reflect.get(Object(json), "modules");
    const authors: unknown = Reflect.get(Object(modules), AUTHORS);
    if (authors === undefined) return route.fulfill({ response });
    realBase = String(Reflect.get(Object(authors), "base"));
    await route.fulfill({
      response,
      json: {
        ...Object(json),
        // Never a 304 from here on: the rewritten answer is the manifest.
        tag: undefined,
        since: undefined,
        modules: {
          ...Object(modules),
          [AUTHORS]: { ...Object(authors), base: OTHER_BASE },
        },
      },
    });
  });
  // And the module endpoint answers on that base: the server's, with one
  // name changed. A version with patches is the server's answer for the
  // real base, its bases renamed: the patches are the same either way.
  let baseReads = 0;
  const renamed = (version: unknown) => ({
    ...Object(version),
    base: OTHER_BASE,
  });
  await page.route("**/api/val/modules/~**", async (route) => {
    const url = new URL(route.request().url());
    const v = url.searchParams.get("v") ?? "";
    if (!v.includes(`.${OTHER_BASE}.`) || realBase === null) {
      return route.fallback();
    }
    const real = new URL(url);
    for (const key of ["v", "have"]) {
      const value = url.searchParams.get(key);
      if (value !== null) {
        real.searchParams.set(key, value.replace(OTHER_BASE, realBase));
      }
    }
    if (v.endsWith(`.${OTHER_BASE}.`)) baseReads += 1;
    const response = await route.fetch({ url: real.toString() });
    if (response.status() !== 200) return route.fulfill({ response });
    const json: unknown = await response.json();
    if (Reflect.get(Object(json), "kind") === "delta") {
      await route.fulfill({
        response,
        json: {
          ...Object(json),
          from: renamed(Reflect.get(Object(json), "from")),
          to: renamed(Reflect.get(Object(json), "to")),
        },
      });
      return;
    }
    const source: unknown = Reflect.get(Object(json), "source");
    const teddy: unknown = Reflect.get(Object(source), "teddy");
    await route.fulfill({
      response,
      json: {
        ...Object(json),
        version: renamed(Reflect.get(Object(json), "version")),
        source: {
          ...Object(source),
          teddy: { ...Object(teddy), name: OTHER_NAME },
        },
      },
    });
  });

  await openHttpStudio(page);
  await expect
    .poll(() => peekAuthors(page), {
      message: "the Studio never put the other base in",
    })
    .toMatchObject({ teddy: { name: OTHER_NAME } });
  expect(baseReads).toBeGreaterThan(0);

  // An edit lands on that base, not on the bundle's.
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
