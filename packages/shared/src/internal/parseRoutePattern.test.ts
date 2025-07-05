import { parseRoutePattern } from "./parseRoutePattern";

describe("parseRoutePattern", () => {
  it("should parse a literal route", () => {
    expect(parseRoutePattern("/dashboard/settings")).toEqual([
      { type: "literal", name: "dashboard" },
      { type: "literal", name: "settings" },
    ]);
  });

  it("should parse a route with a non-optional string param", () => {
    expect(parseRoutePattern("/blogs/[blog]")).toEqual([
      { type: "literal", name: "blogs" },
      { type: "string-param", paramName: "blog", optional: false },
    ]);
  });

  it("should parse a route with an optional string param", () => {
    expect(parseRoutePattern("/categories/[[category]]")).toEqual([
      { type: "literal", name: "categories" },
      { type: "string-param", paramName: "category", optional: true },
    ]);
  });

  it("should parse a route with a non-optional array param (catch-all)", () => {
    expect(parseRoutePattern("/docs/[...slug]")).toEqual([
      { type: "literal", name: "docs" },
      { type: "array-param", paramName: "slug", optional: false },
    ]);
  });

  it("should parse a route with an optional array param (optional catch-all)", () => {
    expect(parseRoutePattern("/search/[[...query]]")).toEqual([
      { type: "literal", name: "search" },
      { type: "array-param", paramName: "query", optional: true },
    ]);
  });

  it("should parse a complex route with multiple params", () => {
    expect(parseRoutePattern("/users/[userId]/posts/[...postIds]")).toEqual([
      { type: "literal", name: "users" },
      { type: "string-param", paramName: "userId", optional: false },
      { type: "literal", name: "posts" },
      { type: "array-param", paramName: "postIds", optional: false },
    ]);
  });

  it("should handle root route", () => {
    expect(parseRoutePattern("/")).toEqual([]);
  });

  it("should handle empty string route", () => {
    expect(parseRoutePattern("")).toEqual([]);
  });

  it("should handle route without leading slash", () => {
    expect(parseRoutePattern("blogs/[blog]")).toEqual([
      { type: "literal", name: "blogs" },
      { type: "string-param", paramName: "blog", optional: false },
    ]);
  });
});
