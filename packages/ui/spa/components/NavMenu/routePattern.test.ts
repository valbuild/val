import { RoutePattern } from "@valbuild/shared/internal";
import { buildFullPath } from "./NewPageForm";
import { routePatternToString } from "./SitemapItem";

const literal = (name: string): RoutePattern => ({ type: "literal", name });
const param = (paramName: string, optional = false): RoutePattern => ({
  type: "string-param",
  paramName,
  optional,
});
const catchAll = (paramName: string, optional = false): RoutePattern => ({
  type: "array-param",
  paramName,
  optional,
});

describe("routePatternToString", () => {
  test("keeps the optional marker, which is part of the route's identity", () => {
    // `[category]` and `[[category]]` are DIFFERENT routes. Dropping the extra
    // brackets made them stringify identically, so two routers collided on one
    // key in collectSitemapRoutes and only one of them was ever offered.
    expect(routePatternToString([literal("shop"), param("category")])).toBe(
      "/shop/[category]",
    );
    expect(
      routePatternToString([literal("shop"), param("category", true)]),
    ).toBe("/shop/[[category]]");
    expect(routePatternToString([literal("docs"), catchAll("slug")])).toBe(
      "/docs/[...slug]",
    );
    expect(
      routePatternToString([literal("docs"), catchAll("slug", true)]),
    ).toBe("/docs/[[...slug]]");
  });

  test("an optional and a required form of one param do not collide", () => {
    expect(routePatternToString([param("x")])).not.toBe(
      routePatternToString([param("x", true)]),
    );
  });
});

describe("buildFullPath", () => {
  test("fills the dynamic segments in order", () => {
    expect(
      buildFullPath([literal("blogs"), param("blog")], { blog: "hello" }),
    ).toBe("/blogs/hello");
  });

  test("an empty OPTIONAL segment is omitted, not left as a trailing slash", () => {
    // `/categories/` and `/categories` are different keys, and the base route
    // is the one Next.js serves for an omitted optional segment.
    expect(
      buildFullPath([literal("categories"), param("category", true)], {}),
    ).toBe("/categories");
    expect(buildFullPath([literal("docs"), catchAll("slug", true)], {})).toBe(
      "/docs",
    );
  });

  test("an optional segment that IS filled in is used", () => {
    expect(
      buildFullPath([literal("categories"), param("category", true)], {
        category: "shoes",
      }),
    ).toBe("/categories/shoes");
  });

  test("a pattern of nothing but omitted optional segments is the root", () => {
    expect(buildFullPath([catchAll("slug", true)], {})).toBe("/");
  });
});
