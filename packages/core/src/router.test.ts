import { NextAppRouterImpl, parseNextJsRoutePattern } from "./router";
import { object } from "./schema/object";
import { record } from "./schema/record";
import { string } from "./schema/string";
import { ModuleFilePath } from "./val";

describe("parseNextJsRoutePattern", () => {
  describe("App Router patterns", () => {
    test("basic dynamic route", () => {
      expect(parseNextJsRoutePattern("/app/blogs/[blog]/page.val.ts")).toEqual([
        "blogs",
        "[blog]",
      ]);
    });

    test("src/app directory structure", () => {
      expect(
        parseNextJsRoutePattern("/src/app/blogs/[blog]/page.val.ts"),
      ).toEqual(["blogs", "[blog]"]);
    });

    test("with .tsx extension", () => {
      expect(parseNextJsRoutePattern("/app/blogs/[blog]/page.tsx")).toEqual([
        "blogs",
        "[blog]",
      ]);
    });

    test("src/app with .tsx extension", () => {
      expect(parseNextJsRoutePattern("/src/app/blogs/[blog]/page.tsx")).toEqual(
        ["blogs", "[blog]"],
      );
    });

    test("optional catch-all segments", () => {
      expect(
        parseNextJsRoutePattern("/app/posts/[[...category]]/page.val.ts"),
      ).toEqual(["posts", "[[...category]]"]);
    });

    test("required catch-all segments", () => {
      expect(
        parseNextJsRoutePattern("/app/docs/[...slug]/page.val.ts"),
      ).toEqual(["docs", "[...slug]"]);
    });

    test("static segments", () => {
      expect(
        parseNextJsRoutePattern("/app/admin/users/[id]/page.val.ts"),
      ).toEqual(["admin", "users", "[id]"]);
    });

    test("root route", () => {
      expect(parseNextJsRoutePattern("/app/page.val.ts")).toEqual([]);
    });

    test("src/app root route", () => {
      expect(parseNextJsRoutePattern("/src/app/page.val.ts")).toEqual([]);
    });
  });

  describe("Group segments", () => {
    test("simple group", () => {
      expect(
        parseNextJsRoutePattern("/app/(marketing)/blogs/[blog]/page.val.ts"),
      ).toEqual(["blogs", "[blog]"]);
    });

    test("multiple groups", () => {
      expect(
        parseNextJsRoutePattern(
          "/app/(marketing)/(public)/blogs/[blog]/page.val.ts",
        ),
      ).toEqual(["blogs", "[blog]"]);
    });

    test("group with src/app", () => {
      expect(
        parseNextJsRoutePattern("/src/app/(admin)/users/[id]/page.val.ts"),
      ).toEqual(["users", "[id]"]);
    });
  });

  describe("Interception routes", () => {
    test("simple interception", () => {
      expect(parseNextJsRoutePattern("/app/(.)feed/page.val.ts")).toEqual([
        "feed",
      ]);
    });

    test("interception with group", () => {
      expect(
        parseNextJsRoutePattern("/app/(..)(dashboard)/feed/[id]/page.val.ts"),
      ).toEqual(["feed", "[id]"]);
    });

    test("interception with multiple dots", () => {
      expect(
        parseNextJsRoutePattern("/app/(...)(dashboard)/feed/[id]/page.val.ts"),
      ).toEqual(["feed", "[id]"]);
    });

    test("interception with src/app", () => {
      expect(parseNextJsRoutePattern("/src/app/(.)feed/page.val.ts")).toEqual([
        "feed",
      ]);
    });
  });

  describe("Edge cases", () => {
    test("invalid file path", () => {
      expect(parseNextJsRoutePattern("/invalid/path/file.ts")).toEqual([]);
    });

    test("empty string", () => {
      expect(parseNextJsRoutePattern("")).toEqual([]);
    });

    test("null/undefined", () => {
      expect(parseNextJsRoutePattern(null as unknown as string)).toEqual([]);
      expect(parseNextJsRoutePattern(undefined as unknown as string)).toEqual(
        [],
      );
    });

    test("file path without page", () => {
      expect(parseNextJsRoutePattern("/app/blogs/[blog]/layout.tsx")).toEqual(
        [],
      );
    });

    test("file path with other extensions", () => {
      expect(parseNextJsRoutePattern("/app/blogs/[blog]/page.js")).toEqual([]);
    });
  });

  describe("Complex combinations", () => {
    test("group + interception + dynamic segments", () => {
      expect(
        parseNextJsRoutePattern(
          "/app/(admin)/(..)(dashboard)/users/[id]/posts/[postId]/page.val.ts",
        ),
      ).toEqual(["users", "[id]", "posts", "[postId]"]);
    });

    test("multiple groups and segments", () => {
      expect(
        parseNextJsRoutePattern(
          "/app/(marketing)/(public)/blog/(category)/[slug]/page.val.ts",
        ),
      ).toEqual(["blog", "[slug]"]);
    });

    test("interception with catch-all", () => {
      expect(
        parseNextJsRoutePattern(
          "/app/(..)(dashboard)/docs/[...slug]/page.val.ts",
        ),
      ).toEqual(["docs", "[...slug]"]);
    });
  });

  describe("Localization", () => {
    const router = new NextAppRouterImpl(
      record(object({ title: string() })),
    ).localize({
      type: "directory",
      segment: "locale",
      translation: "translation",
    });

    test("validate", () => {
      expect(
        router.validate(
          "/app/[locale]/blogs/[blog]/page.val.ts" as ModuleFilePath,
          ["/en/blogs/test"],
        ),
      ).toEqual([]);
    });
  });
});
