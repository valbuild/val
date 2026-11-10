import {
  fillRoute,
  isRoutePattern,
  normalizeRoute,
  routeFitsPattern,
} from "./routePatterns";

describe("page types", () => {
  test("a route with a parameter is a type", () => {
    expect(isRoutePattern("/journal/[slug]")).toBe(true);
    expect(isRoutePattern("/[[...locale]]/news")).toBe(true);
    expect(isRoutePattern("/about")).toBe(false);
  });

  test.each([
    ["/journal/wool", "/journal/[slug]", true],
    ["/journal", "/journal/[slug]", false],
    ["/journal/a/b", "/journal/[slug]", false],
    ["/docs/a/b", "/docs/[...path]", true],
    ["/news", "/[[...locale]]/news", true],
    ["/nb/news", "/[[...locale]]/news", true],
    ["/", "/", true],
  ])("%s is a %s page: %s", (route, pattern, fits) => {
    expect(routeFitsPattern(route, pattern)).toBe(fits);
  });

  test("a page of a type is the type with its parameters filled in", () => {
    expect(fillRoute("/journal/[slug]", { slug: "Traceable wool" })).toBe(
      "/journal/Traceable-wool",
    );
    expect(fillRoute("/journal/[slug]", { slug: "" })).toBeNull();
    expect(fillRoute("/[[...locale]]/news", {})).toBe("/news");
    expect(fillRoute("/docs/[...path]", { path: "guides/routing" })).toBe(
      "/docs/guides/routing",
    );
  });

  test("a typed route has one leading slash", () => {
    expect(normalizeRoute("about us")).toBe("/about-us");
    expect(normalizeRoute("//about")).toBe("/about");
  });
});
