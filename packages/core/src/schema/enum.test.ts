import { EnumSchema, enumSchema } from "./enum";
import { SourcePath } from "../val";

describe("EnumSchema", () => {
  test("assert: should return success for one of the values", () => {
    const schema = enumSchema("one", "two");
    expect(schema["executeAssert"]("foo" as SourcePath, "one")).toEqual({
      success: true,
      data: "one",
    });
  });

  test("assert: should return an error for a value not in the set", () => {
    const schema = enumSchema("one", "two");
    const res = schema["executeAssert"]("foo" as SourcePath, "three");
    expect(res.success).toEqual(false);
  });

  test("assert: should return an error for a non-string", () => {
    const schema = enumSchema("one", "two");
    const res = schema["executeAssert"]("foo" as SourcePath, 1);
    expect(res.success).toEqual(false);
  });

  test("assert: nullable accepts null", () => {
    const schema = enumSchema("one", "two").nullable();
    expect(schema["executeAssert"]("foo" as SourcePath, null)).toEqual({
      success: true,
      data: null,
    });
  });

  test("validate: accepts a value in the set", () => {
    const schema = enumSchema("one", "two");
    expect(schema["executeValidate"]("foo" as SourcePath, "two")).toEqual(
      false,
    );
  });

  test("validate: rejects a value outside the set, naming the values", () => {
    // Constructed widened: the point is a value the factory's own type would
    // not let us pass. `EnumSchema` is invariant in its source (its custom
    // validate functions put it in a parameter position), so a widening
    // annotation would not compile either.
    const schema = new EnumSchema<string>(["one", "two"]);
    expect(schema["executeValidate"]("foo" as SourcePath, "three")).toEqual({
      foo: [
        {
          message: `Value must be one of the following: "one", "two"`,
          value: "three",
        },
      ],
    });
  });

  test("validate: a required enum rejects null", () => {
    const schema = new EnumSchema<string | null>(["one", "two"]);
    const res = schema["executeValidate"]("foo" as SourcePath, null);
    expect(res).toMatchObject({
      foo: [{ typeError: true }],
    });
  });

  test("validate: a nullable enum accepts null", () => {
    const schema = enumSchema("one", "two").nullable();
    expect(schema["executeValidate"]("foo" as SourcePath, null)).toEqual(false);
  });

  test("serializes to the values, in declaration order", () => {
    expect(enumSchema("one", "two", "three")["executeSerialize"]()).toEqual({
      type: "enum",
      values: ["one", "two", "three"],
      opt: false,
      customValidate: false,
      readonly: false,
      hidden: false,
      description: undefined,
      render: undefined,
      preview: undefined,
    });
  });

  test("a custom validator runs and reports", () => {
    const schema = enumSchema("one", "two").validate((src) =>
      src === "one" ? "not one" : false,
    );
    expect(schema["executeValidate"]("foo" as SourcePath, "one")).toEqual({
      foo: [{ message: "not one", value: "one" }],
    });
    expect(schema["executeValidate"]("foo" as SourcePath, "two")).toEqual(
      false,
    );
  });

  test("an enum is a leaf: previewing it reifies nothing", () => {
    expect(enumSchema("one", "two")["executePreview"]()).toEqual({});
  });
});
