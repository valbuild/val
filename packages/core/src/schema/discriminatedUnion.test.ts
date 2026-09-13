import { object } from "./object";
import { discriminatedUnion } from "./discriminatedUnion";
import { literal } from "./literal";
import { ModuleFilePath, SourcePath } from "../val";
import { string } from "./string";
import { record } from "./record";

describe("DiscriminatedUnionSchema", () => {
  test("assert: should return success for a value matching a variant", () => {
    const schema = discriminatedUnion(
      "type",
      object({ type: literal("string") }),
    );
    const res = schema["executeAssert"]("foo" as SourcePath, {
      type: "string",
    });
    expect(res).toEqual({
      success: true,
      data: { type: "string" },
    });
  });

  test("assert: should return success for the only variant", () => {
    const schema = discriminatedUnion(
      "type",
      object({ type: literal("string") }),
    );
    const res = schema["executeAssert"]("foo" as SourcePath, {
      type: "string",
    });
    expect(res).toEqual({
      success: true,
      data: { type: "string" },
    });
  });

  test("assert: should return an error when the tag is missing", () => {
    const schema = discriminatedUnion(
      "type",
      object({ type: literal("string") }),
      object({ type: literal("number") }),
    );
    const res = schema["executeAssert"]("foo" as SourcePath, {
      wrongKey: "string",
    });
    expect(res.success).toEqual(false);
  });

  // Each of these threw a TypeError instead of reporting, because
  // `typeof null === "object"` and because a literal's value was tested for
  // truthiness rather than its type.
  test("validate: a required union holding null reports rather than throwing", () => {
    const schema = discriminatedUnion(
      "type",
      object({ type: literal("a"), v: string() }),
    );
    expect(
      schema["executeValidate"]("foo" as SourcePath, null as never),
    ).toMatchObject({
      foo: [{ message: "Expected an object, got null", typeError: true }],
    });
  });

  test("validate: an empty-string tag is named in the invalid-key error", () => {
    const schema = discriminatedUnion(
      "type",
      object({ type: literal(""), v: string() }),
      object({ type: literal("named"), v: string() }),
    );
    const res = schema["executeValidate"](
      "foo" as SourcePath,
      {
        type: "nope",
        v: "x",
      } as never,
    );
    if (!res) {
      throw new Error("expected validation errors");
    }
    const messages = Object.values(res).flatMap((errors) =>
      errors.map((e) => e.message),
    );
    expect(messages).toEqual([
      `Invalid key: "type". Value was: "nope". Valid values: "", "named"`,
    ]);
  });

  test("validate: a variant missing the discriminator is reported, not thrown on", () => {
    const schema = discriminatedUnion(
      "type",
      object({ type: literal("a"), v: string() }),
      // No `type` key at all: the schema error this reports is the point.
      object({ v: string() }) as never,
    );
    const res = schema["executeValidate"](
      "foo" as SourcePath,
      {
        type: "a",
        v: "x",
      } as never,
    );
    expect(JSON.stringify(res)).toContain("All schema items must be objects");
  });

  test("preview dispatches through the variant the value takes", () => {
    const schema = discriminatedUnion(
      "type",
      object({
        type: literal("value1"),
        innerObject: record(
          object({
            value: string(),
          }).preview(({ val }) => {
            return {
              title: val.value,
            };
          }),
        ),
      }),
      object({ type: literal("value2"), innerString: string() }),
    );

    expect(
      schema["executePreview"]("/test.foo.val.ts" as ModuleFilePath, {
        type: "value1",
        innerObject: {
          record1: { value: "test value 1" },
          record2: { value: "test value 2" },
        },
      }),
    ).toStrictEqual({
      '/test.foo.val.ts?p="innerObject"': {
        status: "success",
        data: {
          parent: "record",
          items: [
            [
              "record1",
              {
                title: "test value 1",
                subtitle: undefined,
                image: undefined,
              },
            ],
            [
              "record2",
              {
                title: "test value 2",
                subtitle: undefined,
                image: undefined,
              },
            ],
          ],
        },
      },
    });
  });
});
