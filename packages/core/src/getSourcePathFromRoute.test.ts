import { getSourcePathFromRoute } from "./getSourcePathFromRoute";
import type { ModuleFilePath } from "./val";
import type { SerializedSchema } from "./schema";

const blogSchema: SerializedSchema = {
  type: "record",
  router: "next-app-router",
  item: { type: "object", items: {}, opt: false },
  opt: false,
};

const pageSchema: SerializedSchema = {
  type: "record",
  router: "next-app-router",
  item: { type: "object", items: {}, opt: false },
  opt: false,
};

const catchAllSchema: SerializedSchema = {
  type: "record",
  router: "next-app-router",
  item: { type: "object", items: {}, opt: false },
  opt: false,
};

const externalSchema: SerializedSchema = {
  type: "record",
  router: "external-url-router",
  item: { type: "object", items: {}, opt: false },
  opt: false,
};

const plainRecordSchema: SerializedSchema = {
  type: "record",
  item: { type: "object", items: {}, opt: false },
  opt: false,
};

const schemas = {
  "/app/blogs/[blog]/page.val.ts": blogSchema,
  "/app/page.val.ts": pageSchema,
  "/app/generic/[[...path]]/page.val.ts": catchAllSchema,
  "/app/external.val.ts": externalSchema,
  "/content/authors.val.ts": plainRecordSchema,
} as Record<ModuleFilePath, SerializedSchema>;

describe("getSourcePathFromRoute", () => {
  test("matches a basic dynamic route", () => {
    const result = getSourcePathFromRoute("/blogs/blog-1", schemas);
    expect(result).toEqual({
      moduleFilePath: "/app/blogs/[blog]/page.val.ts",
      route: "/blogs/blog-1",
      sourcePath: '/app/blogs/[blog]/page.val.ts?p="/blogs/blog-1"',
    });
  });

  test("matches the root route", () => {
    const result = getSourcePathFromRoute("/", schemas);
    expect(result).toEqual({
      moduleFilePath: "/app/page.val.ts",
      route: "/",
      sourcePath: '/app/page.val.ts?p="/"',
    });
  });

  test("matches an optional catch-all route with multiple segments", () => {
    const result = getSourcePathFromRoute("/generic/a/b", schemas);
    expect(result).toEqual({
      moduleFilePath: "/app/generic/[[...path]]/page.val.ts",
      route: "/generic/a/b",
      sourcePath: '/app/generic/[[...path]]/page.val.ts?p="/generic/a/b"',
    });
  });

  test("matches an optional catch-all route with no extra segments", () => {
    const result = getSourcePathFromRoute("/generic", schemas);
    expect(result).toEqual({
      moduleFilePath: "/app/generic/[[...path]]/page.val.ts",
      route: "/generic",
      sourcePath: '/app/generic/[[...path]]/page.val.ts?p="/generic"',
    });
  });

  test("returns null for an unmatched pathname", () => {
    const result = getSourcePathFromRoute("/unknown", schemas);
    expect(result).toBeNull();
  });

  test("skips external-url-router schemas", () => {
    const externalOnly = {
      "/app/external.val.ts": externalSchema,
    } as Record<ModuleFilePath, SerializedSchema>;
    const result = getSourcePathFromRoute(
      "https://www.google.com",
      externalOnly,
    );
    expect(result).toBeNull();
  });

  test("skips records without a router", () => {
    const plainOnly = {
      "/content/authors.val.ts": plainRecordSchema,
    } as Record<ModuleFilePath, SerializedSchema>;
    const result = getSourcePathFromRoute("/authors", plainOnly);
    expect(result).toBeNull();
  });

  test("sourcePath JSON-quotes the pathname", () => {
    const result = getSourcePathFromRoute("/blogs/my-post", schemas);
    expect(result?.sourcePath).toBe(
      '/app/blogs/[blog]/page.val.ts?p="/blogs/my-post"',
    );
  });
});
