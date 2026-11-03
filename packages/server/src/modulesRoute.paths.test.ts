import { initVal, type ModuleFilePath, type ValModules } from "@valbuild/core";
import { createValClient } from "@valbuild/shared/internal";
import { createInTabValFetch } from "./browser/inTabFetch";

/**
 * `GET /modules/~<path>` for module paths a URL spells differently from the
 * file: a TanStack optional segment (`{-$locale}`), a space, Norwegian
 * letters. The Studio's client appends the path as it is, `new URL()` (or
 * the browser's `fetch`) percent-encodes it, and the route has to read it
 * back as the file it names -- a 404 here is a module that never moves to
 * the server's version.
 *
 * Driven through the Studio's own client and the router, as the demo and
 * every Studio send it: only the network is removed.
 */

const { s, c, config } = initVal({});

const PATHS = [
  "/src/routes/_site.{-$locale}.news.$slug.val.ts",
  "/content/with space.val.ts",
  "/content/blåbærsyltetøy.val.ts",
  "/content/ÆØÅ {x}.val.ts",
] as const;

const valModules: ValModules = {
  config,
  modules: PATHS.map((path) => ({
    def: () =>
      Promise.resolve({
        default: c.define(path, s.object({ title: s.string() }), {
          title: path,
        }),
      }),
  })),
};

describe("GET /modules/~ with paths a URL encodes", () => {
  const client = createValClient("/api/val", null, {
    fetch: createInTabValFetch(valModules, { config }),
  });

  test.each(PATHS)("%s", async (path) => {
    const res = await client("/modules/~", "GET", {
      path: path as ModuleFilePath,
      query: { v: undefined, have: undefined },
    });
    expect(res.status).toBe(200);
    if (res.status !== 200 || res.json.kind !== "module") {
      throw new Error(JSON.stringify(res.json));
    }
    expect(res.json.source).toEqual({ title: path });
  });
});
