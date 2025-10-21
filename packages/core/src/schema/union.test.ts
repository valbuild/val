import { object } from "./object";
import { union } from "./union";
import { literal } from "./literal";
import { ModuleFilePath, SourcePath } from "../val";
import { string } from "./string";
import { record } from "./record";

describe("UnionSchema", () => {
  // tagged unions:
  test("assert: tagged unions should return success for valid tagged unions", () => {
    const schema = union("type", object({ type: literal("string") }));
    const res = schema["executeAssert"]("foo" as SourcePath, {
      type: "string",
    });
    expect(res).toEqual({
      success: true,
      data: { type: "string" },
    });
  });

  test("assert: tagged unions should return success if value is a string", () => {
    const schema = union("type", object({ type: literal("string") }));
    const res = schema["executeAssert"]("foo" as SourcePath, {
      type: "string",
    });
    expect(res).toEqual({
      success: true,
      data: { type: "string" },
    });
  });

  test("assert: tagged unions should return error if value is a string", () => {
    const schema = union(
      "type",
      object({ type: literal("string") }),
      object({ type: literal("number") }),
    );
    const res = schema["executeAssert"]("foo" as SourcePath, {
      wrongKey: "string",
    });
    expect(res.success).toEqual(false);
  });

  // string unions:
  test("assert: string unions should return success for valid string unions", () => {
    const schema = union(literal("one"), literal("two"));
    const res = schema["executeAssert"]("foo" as SourcePath, "one");
    expect(res).toEqual({
      success: true,
      data: "one",
    });
  });

  test("assert: string unions should return error for valid string unions", () => {
    const schema = union(literal("one"), literal("two"));
    const res = schema["executeAssert"]("foo" as SourcePath, "false");
    expect(res.success).toEqual(false);
  });

  test("render union object schema", () => {
    const schema = union(
      "type",
      object({
        type: literal("value1"),
        innerObject: record(
          object({
            value: string(),
          }),
        ).render({
          as: "list",
          select: ({ val }) => {
            return {
              title: val.value,
            };
          },
        }),
      }),
      object({ type: literal("value2"), innerString: string() }),
    );

    expect(
      schema["executeRender"]("/test.foo.val.ts" as ModuleFilePath, {
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
          layout: "list",
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
