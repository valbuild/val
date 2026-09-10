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
