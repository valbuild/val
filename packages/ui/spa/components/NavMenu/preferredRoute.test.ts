import { ModuleFilePath } from "@valbuild/core";
import { parseRoutePattern } from "@valbuild/shared/internal";
import {
  AvailableRoute,
  patternMatchesPath,
  preferredRoute,
} from "./NewPageForm";

/**
 * Which route the New page form starts on.
 *
 * The form's own answer used to be "the first one in the list", which is nobody's
 * answer in particular: adding a blog post from a blog post meant noticing the
 * select, working out which of the project's patterns you wanted, and picking it.
 * What is being tested here is the guess that replaces it — and, mostly, that it
 * stays a guess: every case where nothing matches has to still produce the head
 * of the list rather than nothing at all.
 */

function route(moduleFilePath: string, patternString: string): AvailableRoute {
  return {
    moduleFilePath: moduleFilePath as ModuleFilePath,
    routePattern: parseRoutePattern(patternString),
    patternString,
    existingKeys: [],
  };
}

const blogs = route("/app/blogs/[blog]/page.val.ts", "/blogs/[blog]");
const products = route(
  "/app/products/[category]/[product]/page.val.ts",
  "/products/[category]/[product]",
);
const docs = route("/app/docs/[...slug]/page.val.ts", "/docs/[...slug]");

describe("patternMatchesPath", () => {
  test("a literal has to be itself", () => {
    expect(patternMatchesPath(parseRoutePattern("/about"), "/about")).toBe(
      true,
    );
    expect(patternMatchesPath(parseRoutePattern("/about"), "/contact")).toBe(
      false,
    );
  });

  test("a param stands for exactly one segment", () => {
    const pattern = parseRoutePattern("/blogs/[blog]");
    expect(patternMatchesPath(pattern, "/blogs/why-val")).toBe(true);
    expect(patternMatchesPath(pattern, "/blogs")).toBe(false);
    expect(patternMatchesPath(pattern, "/blogs/why-val/comments")).toBe(false);
  });

  test("an optional param may stand for nothing", () => {
    const pattern = parseRoutePattern("/categories/[[category]]");
    expect(patternMatchesPath(pattern, "/categories")).toBe(true);
    expect(patternMatchesPath(pattern, "/categories/shoes")).toBe(true);
    expect(patternMatchesPath(pattern, "/categories/shoes/red")).toBe(false);
  });

  test("a catch-all takes the rest, but needs at least one", () => {
    const pattern = parseRoutePattern("/docs/[...slug]");
    expect(patternMatchesPath(pattern, "/docs/getting-started")).toBe(true);
    expect(patternMatchesPath(pattern, "/docs/guides/routing/deep")).toBe(true);
    expect(patternMatchesPath(pattern, "/docs")).toBe(false);
    expect(
      patternMatchesPath(parseRoutePattern("/search/[[...query]]"), "/search"),
    ).toBe(true);
  });

  test("the root pattern is the root", () => {
    expect(patternMatchesPath(parseRoutePattern("/"), "/")).toBe(true);
    expect(patternMatchesPath(parseRoutePattern("/"), "/blogs")).toBe(false);
  });
});

describe("preferredRoute", () => {
  const routes = [blogs, products, docs];

  test("with nothing open, the first route", () => {
    expect(preferredRoute(routes, undefined)).toBe(blogs);
  });

  test("picks the route the open page is on", () => {
    expect(
      preferredRoute(routes, {
        moduleFilePath: products.moduleFilePath,
        urlPath: "/products/shoes/runner",
      }),
    ).toBe(products);
  });

  test("the URL decides between two routes in the same module", () => {
    // One router module can define several patterns, so the module alone does
    // not name a route.
    const one = route("/content/site.val.ts", "/blogs/[blog]");
    const two = route("/content/site.val.ts", "/authors/[author]");
    expect(
      preferredRoute([one, two], {
        moduleFilePath: one.moduleFilePath,
        urlPath: "/authors/theodor",
      }),
    ).toBe(two);
  });

  test("the module decides between two routes of the same shape", () => {
    // And two routers can accept the same URL shape, so the URL alone does not
    // name a module.
    const one = route("/app/a/[slug]/page.val.ts", "/a/[slug]");
    const two = route("/app/b/[slug]/page.val.ts", "/b/[slug]");
    expect(
      preferredRoute([one, two], {
        moduleFilePath: two.moduleFilePath,
        urlPath: "/nowhere/at-all",
      }),
    ).toBe(two);
  });

  test("a page on none of them still gets a route", () => {
    expect(
      preferredRoute(routes, {
        moduleFilePath: "/content/settings.val.ts" as ModuleFilePath,
        urlPath: "/somewhere/else",
      }),
    ).toBe(blogs);
  });

  test("no routes at all is no route", () => {
    expect(
      preferredRoute([], {
        moduleFilePath: blogs.moduleFilePath,
        urlPath: "/blogs/why-val",
      }),
    ).toBeUndefined();
  });
});
