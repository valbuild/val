import { object } from "./object";
import { union } from "./union";
import { literal } from "./literal";
import { SourcePath } from "../val";
import { string } from "./string";
import { record } from "./record";

describe("UnionSchema", () => {
  // tagged unions:
  test("assert: tagged unions should return success for valid tagged unions", () => {
    const schema = union("type", object({ type: literal("string") }));
    const res = schema.assert("foo" as SourcePath, { type: "string" });
    expect(res).toEqual({
      success: true,
      data: { type: "string" },
    });
  });

  test("assert: tagged unions should return success if value is a string", () => {
    const schema = union("type", object({ type: literal("string") }));
    const res = schema.assert("foo" as SourcePath, { type: "string" });
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
    const res = schema.assert("foo" as SourcePath, { wrongKey: "string" });
    expect(res.success).toEqual(false);
  });

  // string unions:
  test("assert: string unions should return success for valid string unions", () => {
    const schema = union(literal("one"), literal("two"));
    const res = schema.assert("foo" as SourcePath, "one");
    expect(res).toEqual({
      success: true,
      data: "one",
    });
  });

  test("assert: string unions should return error for valid string unions", () => {
    const schema = union(literal("one"), literal("two"));
    const res = schema.assert("foo" as SourcePath, "false");
    expect(res.success).toEqual(false);
  });

  test("preview union object schema", () => {
    const schema = union(
      "type",
      object({
        type: literal("value1"),
        innerObject: record(
          object({
            value: string(),
          }),
        ).preview({
          as: "card",
          display: ({ val }) => {
            return {
              title: val.value,
            };
          },
        }),
      }),
      object({ type: literal("value1"), innerString: string() }),
    );

    console.log(
      JSON.stringify(
        schema["executePreview"]({
          type: "value1",
          innerObject: { record1: { value: "test value" } },
        }),
        null,
        2,
      ),
    );
  });
});
