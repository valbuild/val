/* eslint-disable @typescript-eslint/no-explicit-any */
import { nextAppRouter } from "../router";
import { SourcePath } from "../val";
import { number } from "./number";
import { object } from "./object";
import { record } from "./record";
import { string } from "./string";

describe("RecordSchema", () => {
  test("assert: basic record", () => {
    const schema = record(number().nullable());
    expect(schema["executeAssert"]("foo" as SourcePath, { bar: 1 })).toEqual({
      success: true,
      data: { bar: 1 },
    });
  });

  test("record: nested renders", () => {
    const schema = record(
      object({
        title: string(),
        bar: record(
          object({
            baz: string().nullable(),
          }),
        ).render({
          layout: "list",
          select: ({ val }) => {
            return {
              title: val.baz || "No baz",
            };
          },
        }),
      }).nullable(),
    ).render({
      layout: "list",
      select: ({ val }) => {
        return {
          title: val?.title || "No item",
        };
      },
    });
    const src = {
      "upper-key": {
        title: "test",
        bar: {
          test1: {
            baz: "baz",
          },
        },
      },
      "nullable-key": null,
    };
    const res = schema["executeRender"]("/test.val.ts" as SourcePath, src);
    expect(res).toStrictEqual({
      '/test.val.ts?p="upper-key"."bar"': {
        status: "success",
        data: {
          layout: "list",
          parent: "record",
          items: [
            ["test1", { title: "baz", subtitle: undefined, image: undefined }],
          ],
        },
      },
      "/test.val.ts": {
        status: "success",
        data: {
          layout: "list",
          parent: "record",
          items: [
            [
              "upper-key",
              { title: "test", subtitle: undefined, image: undefined },
            ],
            [
              "nullable-key",
              { title: "No item", subtitle: undefined, image: undefined },
            ],
          ],
        },
      },
    });
  });

  test("record: router", () => {
    const schema = record(object({ title: string() })).router(nextAppRouter);
    expect(
      schema["executeValidate"]("/app/blogs/[blog]/page.val.ts" as SourcePath, {
        "/blogs/test": { title: "Test" },
      }),
    ).toBe(false); // No validation errors for valid path
  });

  test("router validation: src/app directory structure", () => {
    const schema = record(object({ title: string() })).router(nextAppRouter);
    const result = schema["executeValidate"](
      "/src/app/blogs/[blog]/page.val.ts" as SourcePath,
      {
        "/blogs/test": { title: "Test" }, // Valid
        "/blog/test": { title: "Invalid" }, // Wrong path
      },
    );

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(
        Object.values(result).some((errors) =>
          errors.some((error) => error.message.includes("/blog/test")),
        ),
      ).toBe(true);
    }
  });

  test("router validation: with groups", () => {
    const schema = record(object({ title: string() })).router(nextAppRouter);
    const result = schema["executeValidate"](
      "/app/(marketing)/blogs/[blog]/page.val.ts" as SourcePath,
      {
        "/blogs/test": { title: "Test" }, // Valid - group is ignored in URL
        "/blog/test": { title: "Invalid" }, // Wrong path
      },
    );

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(
        Object.values(result).some((errors) =>
          errors.some((error) => error.message.includes("/blog/test")),
        ),
      ).toBe(true);
    }
  });

  test("router validation: pages router", () => {
    const schema = record(object({ title: string() })).router(nextAppRouter);
    const result = schema["executeValidate"](
      "/pages/blogs/[blog].tsx" as SourcePath,
      {
        "/blogs/test": { title: "Test" }, // Valid
        "/blog/test": { title: "Invalid" }, // Wrong path
      },
    );

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(
        Object.values(result).some((errors) =>
          errors.some((error) => error.message.includes("/blog/test")),
        ),
      ).toBe(true);
    }
  });

  test("router validation: basic dynamic route", () => {
    const schema = record(object({ title: string() })).router(nextAppRouter);
    const result = schema["executeValidate"](
      "/app/blogs/[blog]/page.val.ts" as SourcePath,
      {
        "/blogs/test": { title: "Test" },
        "/blog/test": { title: "Invalid" }, // Wrong path
        "/blogs/test/extra": { title: "Too many segments" }, // Too many segments
      },
    );

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(Object.keys(result)).toHaveLength(2);
      expect(
        Object.values(result).some((errors) =>
          errors.some((error) => error.message.includes("/blog/test")),
        ),
      ).toBe(true);
      expect(
        Object.values(result).some((errors) =>
          errors.some((error) => error.message.includes("/blogs/test/extra")),
        ),
      ).toBe(true);
    }
  });

  test("router validation: optional catch-all segments", () => {
    const schema = record(object({ title: string() })).router(nextAppRouter);
    const result = schema["executeValidate"](
      "/app/posts/[[...category]]/page.val.ts" as SourcePath,
      {
        "/posts": { title: "All posts" }, // Valid - optional catch-all omitted
        "/posts/tech": { title: "Tech posts" }, // Valid
        "/posts/tech/extra": { title: "Extra" }, // Valid
      },
    );

    expect(result).toBe(false); // No validation errors
  });

  test("router validation: required segment", () => {
    const schema = record(object({ title: string() })).router(nextAppRouter);
    const result = schema["executeValidate"](
      "/app/posts/[category]/page.val.ts" as SourcePath,
      {
        "/posts": { title: "All posts" }, // Invalid
        "/posts/tech": { title: "Tech posts" }, // Valid
        "/posts/tech/extra": { title: "Extra" }, // Invalid
      },
    );

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(Object.keys(result)).toHaveLength(2);
      expect(
        Object.values(result).some((errors) =>
          errors.some((error) => error.message.includes("/posts")),
        ),
      ).toBe(true);
      expect(
        Object.values(result).some((errors) =>
          errors.some((error) => error.message.includes("/posts/tech/extra")),
        ),
      ).toBe(true);
    }
  });

  test("router validation: catch-all segments", () => {
    const schema = record(object({ title: string() })).router(nextAppRouter);
    const result = schema["executeValidate"](
      "/app/docs/[...slug]/page.val.ts" as SourcePath,
      {
        "/docs": { title: "Docs" }, // Invalid - catch-all requires at least one segment
        "/docs/getting-started": { title: "Getting Started" }, // Valid
        "/docs/getting-started/installation": { title: "Installation" }, // Valid
        "/docs/getting-started/installation/advanced": { title: "Advanced" }, // Valid
      },
    );

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(Object.keys(result)).toHaveLength(1);
      expect(
        Object.values(result).some((errors) =>
          errors.some((error) => error.message.includes("/docs")),
        ),
      ).toBe(true);
    }
  });

  test("router validation: static segments", () => {
    const schema = record(object({ title: string() })).router(nextAppRouter);
    const result = schema["executeValidate"](
      "/app/admin/users/[id]/page.val.ts" as SourcePath,
      {
        "/admin/users/123": { title: "User 123" }, // Valid
        "/admin/users": { title: "Users list" }, // Invalid - missing required segment
        "/admin/other/123": { title: "Wrong path" }, // Invalid - wrong static segment
      },
    );

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(Object.keys(result)).toHaveLength(2);
    }
  });

  test("router validation: root route", () => {
    const schema = record(object({ title: string() })).router(nextAppRouter);
    const result = schema["executeValidate"]("/app/page.val.ts" as SourcePath, {
      "/": { title: "Home" }, // Valid
      "/about": { title: "About" }, // Invalid - root route only
    });

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(Object.keys(result)).toHaveLength(1);
      expect(
        Object.values(result).some((errors) =>
          errors.some((error) => error.message.includes("/about")),
        ),
      ).toBe(true);
    }
  });

  test("router validation: interception route", () => {
    const schema = record(object({ title: string() })).router(nextAppRouter);
    const result = schema["executeValidate"](
      "/app/(..)(dashboard)/feed/[id]/page.val.ts" as SourcePath,
      {
        "/feed/123": { title: "Feed 123" }, // Valid
        "/dashboard/feed/123": { title: "Invalid" }, // Invalid, interception segment not in URL
      },
    );

    expect(result).not.toBe(false);
    if (result !== false) {
      expect(
        Object.values(result).some((errors) =>
          errors.some((error) => error.message.includes("/dashboard/feed/123")),
        ),
      ).toBe(true);
    }
  });
});
