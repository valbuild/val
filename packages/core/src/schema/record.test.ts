/* eslint-disable @typescript-eslint/no-explicit-any */
import { nextAppRouter } from "../router";
import { SourcePath } from "../val";
import { deserializeSchema } from "./deserialize";
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
          as: "list",
          select: ({ val }) => {
            return {
              title: val.baz || "No baz",
            };
          },
        }),
      }).nullable(),
    ).render({
      as: "list",
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
      const error = Object.values(result).find((errors) =>
        errors.find((error) => error.value === "/blog/test"),
      )?.[0];
      expect(error?.value).toStrictEqual("/blog/test");
      expect(error?.keyError).toBe(true);
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

  describe("Key validation", () => {
    test("record with key schema: valid keys", () => {
      const schema = record(
        string().validate((key) => {
          if (key.startsWith("test-")) {
            return false;
          }
          return "Key must start with 'test-'";
        }),
        number(),
      );

      const result = schema["executeValidate"]("/test.val.ts" as SourcePath, {
        "test-1": 1,
        "test-2": 2,
      });

      expect(result).toBe(false); // No validation errors
    });

    test("record with key schema: invalid keys", () => {
      const schema = record(
        string().validate((key) => {
          if (key.startsWith("test-")) {
            return false;
          }
          return "Key must start with 'test-'";
        }),
        number(),
      );

      const result = schema["executeValidate"]("/test.val.ts" as SourcePath, {
        "test-1": 1,
        invalid: 2,
        "bad-key": 3,
      });

      expect(result).not.toBe(false);
      if (result !== false) {
        expect(Object.keys(result).length).toBeGreaterThan(0);
        // should have keyError set to true for key validation errors
        expect(
          Object.values(result).reduce(
            (acc, errors) =>
              errors.filter((error) => error.keyError).length + acc,
            0,
          ),
        ).toBe(2);
      }
    });

    test("record with key schema: multiple validation rules", () => {
      const schema = record(
        string()
          .validate((key) => {
            if (key.length >= 3) {
              return false;
            }
            return "Key must be at least 3 characters long";
          })
          .validate((key) => {
            if (/^[a-z-]+$/.test(key)) {
              return false;
            }
            return "Key must only contain lowercase letters and hyphens";
          }),
        string(),
      );

      const result = schema["executeValidate"]("/test.val.ts" as SourcePath, {
        "valid-key": "value1",
        ab: "value2", // Too short
        Invalid: "value3", // Has uppercase
        "valid-123": "value4", // Has numbers
      });

      expect(result).not.toBe(false);
      if (result !== false) {
        expect(Object.keys(result).length).toBeGreaterThan(0);
      }
    });

    test("record without key schema: no key validation", () => {
      const schema = record(number());

      const result = schema["executeValidate"]("/test.val.ts" as SourcePath, {
        "any-key": 1,
        ANY_KEY: 2,
        "123": 3,
        "!@#$": 4,
      });

      expect(result).toBe(false); // No validation errors - keys are not validated
    });

    test("record with key schema: nullable values", () => {
      const schema = record(
        string().validate((key) => {
          if (key.startsWith("item-")) {
            return false;
          }
          return "Key must start with 'item-'";
        }),
        string().nullable(),
      );

      const result = schema["executeValidate"]("/test.val.ts" as SourcePath, {
        "item-1": "value1",
        "item-2": null,
        wrong: "value3",
      });

      expect(result).not.toBe(false);
      if (result !== false) {
        // Should have error for 'wrong' key
        expect(Object.keys(result).length).toBeGreaterThan(0);
      }
    });

    test("record with key schema: complex value types", () => {
      const schema = record(
        string().validate((key) => {
          if (/^[a-z]+$/.test(key)) {
            return false;
          }
          return "Key must contain only lowercase letters";
        }),
        object({
          title: string(),
          count: number(),
        }),
      );

      const result = schema["executeValidate"]("/test.val.ts" as SourcePath, {
        validkey: { title: "Valid", count: 1 },
        "invalid-key": { title: "Invalid", count: 2 },
      });

      expect(result).not.toBe(false);
      if (result !== false) {
        expect(Object.keys(result).length).toBeGreaterThan(0);
      }
    });

    test("record with key schema: nullable record", () => {
      const schema = record(
        string().validate((key) => {
          if (key.length > 0) {
            return false;
          }
          return "Key must not be empty";
        }),
        string(),
      ).nullable();

      const result = schema["executeValidate"](
        "/test.val.ts" as SourcePath,
        null,
      );

      expect(result).toBe(false); // Null is valid for nullable record
    });

    test("record with key schema: serialize includes keySchema", () => {
      const keySchema = string().validate((key) => {
        if (key.startsWith("test-")) {
          return false;
        }
        return "Key must start with 'test-'";
      });
      const schema = record(keySchema, number());

      const serialized = schema["executeSerialize"]();

      expect(serialized.type).toBe("record");
      expect(serialized.item).toBeDefined();
      expect(serialized.key).toBeDefined();
      expect(serialized.key?.type).toBe("string");
    });

    test("record without key schema: serialize excludes keySchema", () => {
      const schema = record(number());

      const serialized = schema["executeSerialize"]();

      expect(serialized.type).toBe("record");
      expect(serialized.item).toBeDefined();
      expect(serialized.key).toBeUndefined();
    });
  });

  test("deserialize: round-trip serialization with key schema", () => {
    const keySchema = string().maxLength(3);
    const schema = record(keySchema, number());

    const serialized = schema["executeSerialize"]();
    const deserialized = deserializeSchema(serialized);

    const failingRes = deserialized["executeValidate"](
      "/test.val.ts" as SourcePath,
      {
        failhere: 1,
        andhere: 2,
      },
    );
    expect(failingRes).not.toBe(false);
    if (failingRes !== false) {
      expect(Object.keys(failingRes).length).toBe(2); // Both keys should fail maxLength
    }

    const passingRes = deserialized["executeValidate"](
      "/test.val.ts" as SourcePath,
      {
        ok: 1,
        yes: 2,
      },
    );
    expect(passingRes).toBe(false); // No validation errors

    const reserialized = deserialized["executeSerialize"]();

    // Compare structures (note: custom validate functions won't be preserved)
    expect(reserialized.type).toBe("record");
    expect(reserialized.opt).toBe(serialized.opt);
    if (reserialized.type === "record" && serialized.type === "record") {
      expect(reserialized.item.type).toBe(serialized.item.type);
      expect(reserialized.key?.type).toBe(serialized.key?.type);
    }
  });
});
