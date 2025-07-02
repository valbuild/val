import { extractRoutePatternParams } from "./extractRoutePatternParams";
import { parseRoutePattern } from "./parseRoutePattern";

describe("extractRoutePatternParams", () => {
  describe("basic literal routes", () => {
    it("should extract params from a simple literal route", () => {
      const pattern = parseRoutePattern("/dashboard");
      const result = extractRoutePatternParams(pattern, "/dashboard");

      expect(result).toEqual({ status: "success", params: {} });
    });

    it("should extract params from a nested literal route", () => {
      const pattern = parseRoutePattern("/dashboard/settings");
      const result = extractRoutePatternParams(pattern, "/dashboard/settings");

      expect(result).toEqual({ status: "success", params: {} });
    });

    it("should fail for mismatched literal parts", () => {
      const pattern = parseRoutePattern("/dashboard/settings");
      const result = extractRoutePatternParams(pattern, "/dashboard/profile");

      expect(result).toMatchObject({
        status: "error",
      });
    });

    it("should fail for missing literal parts", () => {
      const pattern = parseRoutePattern("/dashboard/settings");
      const result = extractRoutePatternParams(pattern, "/dashboard");

      expect(result).toMatchObject({
        status: "error",
      });
    });
  });

  describe("string parameter routes", () => {
    it("should extract params from a route with a string parameter", () => {
      const pattern = parseRoutePattern("/blogs/[blog]");
      const result = extractRoutePatternParams(pattern, "/blogs/foo");

      expect(result).toEqual({ status: "success", params: { blog: "foo" } });
    });

    it("should extract params from a route with multiple string parameters", () => {
      const pattern = parseRoutePattern("/users/[userId]/posts/[postId]");
      const result = extractRoutePatternParams(pattern, "/users/123/posts/456");

      expect(result).toEqual({
        status: "success",
        params: { userId: "123", postId: "456" },
      });
    });

    it("should fail for missing required string parameter", () => {
      const pattern = parseRoutePattern("/blogs/[blog]");
      const result = extractRoutePatternParams(pattern, "/blogs");

      expect(result).toMatchObject({
        status: "error",
      });
    });

    it("should handle optional string parameters when present", () => {
      const pattern = parseRoutePattern("/categories/[[category]]");
      const result = extractRoutePatternParams(pattern, "/categories/tech");

      expect(result).toEqual({
        status: "success",
        params: { category: "tech" },
      });
    });

    it("should handle optional string parameters when missing", () => {
      const pattern = parseRoutePattern("/categories/[[category]]");
      const result = extractRoutePatternParams(pattern, "/categories");

      expect(result).toEqual({ status: "success", params: {} });
    });

    it("should handle mixed literal and string parameters", () => {
      const pattern = parseRoutePattern("/api/users/[userId]/profile");
      const result = extractRoutePatternParams(
        pattern,
        "/api/users/123/profile",
      );

      expect(result).toEqual({ status: "success", params: { userId: "123" } });
    });
  });

  describe("catch-all (array) parameter routes", () => {
    it("should extract params from a catch-all route", () => {
      const pattern = parseRoutePattern("/docs/[...slug]");
      const result = extractRoutePatternParams(
        pattern,
        "/docs/getting-started/installation",
      );

      expect(result).toEqual({
        status: "success",
        params: { slug: ["getting-started", "installation"] },
      });
    });

    it("should extract params from a catch-all route with single segment", () => {
      const pattern = parseRoutePattern("/docs/[...slug]");
      const result = extractRoutePatternParams(pattern, "/docs/introduction");

      expect(result).toEqual({
        status: "success",
        params: { slug: ["introduction"] },
      });
    });

    it("should fail for missing required catch-all parameter", () => {
      const pattern = parseRoutePattern("/docs/[...slug]");
      const result = extractRoutePatternParams(pattern, "/docs");

      expect(result).toMatchObject({
        status: "error",
      });
    });

    it("should handle optional catch-all parameters when present", () => {
      const pattern = parseRoutePattern("/search/[[...query]]");
      const result = extractRoutePatternParams(
        pattern,
        "/search/advanced/filters",
      );

      expect(result).toEqual({
        status: "success",
        params: { query: ["advanced", "filters"] },
      });
    });

    it("should handle optional catch-all parameters when missing", () => {
      const pattern = parseRoutePattern("/search/[[...query]]");
      const result = extractRoutePatternParams(pattern, "/search");

      expect(result).toEqual({ status: "success", params: {} });
    });

    it("should handle complex routes with mixed parameter types", () => {
      const pattern = parseRoutePattern("/users/[userId]/posts/[...postIds]");
      const result = extractRoutePatternParams(
        pattern,
        "/users/123/posts/456/789/101",
      );

      expect(result).toEqual({
        status: "success",
        params: { userId: "123", postIds: ["456", "789", "101"] },
      });
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle root route", () => {
      const pattern = parseRoutePattern("/");
      const result = extractRoutePatternParams(pattern, "/");

      expect(result).toEqual({ status: "success", params: {} });
    });

    it("should handle empty route", () => {
      const pattern = parseRoutePattern("");
      const result = extractRoutePatternParams(pattern, "");

      expect(result).toEqual({ status: "success", params: {} });
    });

    it("should handle routes without leading slash", () => {
      const pattern = parseRoutePattern("blogs/[blog]");
      const result = extractRoutePatternParams(pattern, "/blogs/foo");

      expect(result).toEqual({ status: "success", params: { blog: "foo" } });
    });

    it("should handle URLs without leading slash", () => {
      const pattern = parseRoutePattern("/blogs/[blog]");
      const result = extractRoutePatternParams(pattern, "blogs/foo");

      expect(result).toEqual({ status: "success", params: { blog: "foo" } });
    });

    it("should handle consecutive slashes", () => {
      const pattern = parseRoutePattern("/blogs/[blog]");
      const result = extractRoutePatternParams(pattern, "/blogs//foo");

      expect(result).toEqual({ status: "success", params: { blog: "foo" } });
    });

    it("should handle trailing slashes", () => {
      const pattern = parseRoutePattern("/blogs/[blog]");
      const result = extractRoutePatternParams(pattern, "/blogs/foo/");

      expect(result).toEqual({ status: "success", params: { blog: "foo" } });
    });

    it("should fail for extra path parts", () => {
      const pattern = parseRoutePattern("/blogs/[blog]");
      const result = extractRoutePatternParams(pattern, "/blogs/foo/extra");

      expect(result).toMatchObject({
        status: "error",
      });
    });

    it("should fail for too few path parts", () => {
      const pattern = parseRoutePattern("/blogs/[blog]/comments");
      const result = extractRoutePatternParams(pattern, "/blogs/foo");

      expect(result).toMatchObject({
        status: "error",
      });
    });

    it("should handle null/undefined URL path", () => {
      const pattern = parseRoutePattern("/blogs/[blog]");
      const result = extractRoutePatternParams(pattern, "");

      expect(result).toMatchObject({
        status: "error",
      });
    });
  });

  describe("Next.js App Router specific scenarios", () => {
    it("should handle dynamic routes with single parameter", () => {
      const pattern = parseRoutePattern("/posts/[id]");
      const result = extractRoutePatternParams(pattern, "/posts/123");

      expect(result).toEqual({ status: "success", params: { id: "123" } });
    });

    it("should handle dynamic routes with multiple parameters", () => {
      const pattern = parseRoutePattern("/posts/[category]/[id]");
      const result = extractRoutePatternParams(pattern, "/posts/tech/123");

      expect(result).toEqual({
        status: "success",
        params: { category: "tech", id: "123" },
      });
    });

    it("should handle catch-all routes for nested paths", () => {
      const pattern = parseRoutePattern("/shop/[...slug]");
      const result = extractRoutePatternParams(
        pattern,
        "/shop/electronics/phones/iphone",
      );

      expect(result).toEqual({
        status: "success",
        params: { slug: ["electronics", "phones", "iphone"] },
      });
    });

    it("should handle optional catch-all routes", () => {
      const pattern = parseRoutePattern("/blog/[[...slug]]");
      const result = extractRoutePatternParams(pattern, "/blog");

      expect(result).toEqual({ status: "success", params: {} });
    });

    it("should handle complex nested routes", () => {
      const pattern = parseRoutePattern(
        "/admin/users/[userId]/settings/[[...section]]",
      );
      const result = extractRoutePatternParams(
        pattern,
        "/admin/users/123/settings/profile/security",
      );

      expect(result).toEqual({
        status: "success",
        params: { userId: "123", section: ["profile", "security"] },
      });
    });

    it("should handle API routes", () => {
      const pattern = parseRoutePattern("/api/users/[id]");
      const result = extractRoutePatternParams(pattern, "/api/users/456");

      expect(result).toEqual({ status: "success", params: { id: "456" } });
    });
  });
});
