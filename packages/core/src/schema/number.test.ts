/* eslint-disable @typescript-eslint/no-explicit-any */
import { SourcePath } from "../val";
import { number } from "./number";

describe("NumberSchema", () => {
  test("assert: should return success if src is a number", () => {
    const schema = number().nullable();
    const test = schema["executeAssert"]("foo" as SourcePath, 1);
    if (test.success) {
      test.data;
    }
    expect(schema["executeAssert"]("foo" as SourcePath, 1)).toEqual({
      success: true,
      data: 1,
    });
  });
  test("assert: should return errors if src is a string", () => {
    const schema = number();
    expect(
      schema["executeAssert"]("foo" as SourcePath, "1" as any).success,
    ).toEqual(false);
  });

  test("validate: should return success if src is a number", () => {
    const schema = number().nullable();
    const result = schema["executeValidate"]("foo" as SourcePath, 1 as any);
    expect(result).toEqual(false);
  });

  test("validate: should return success if src is within min and max", () => {
    const schema = number().min(10).max(20);
    const result = schema["executeValidate"]("foo" as SourcePath, 15 as any);
    expect(result).toEqual(false);
  });

  test("validate: should return errors if src is greater than max", () => {
    const schema = number().max(10);
    const result = schema["executeValidate"]("foo" as SourcePath, 11 as any);
    expect(result).toMatchObject({
      foo: [
        {
          value: 11,
        },
      ],
    });
  });

  test("validate: should return errors if src is less than min", () => {
    const schema = number().min(10);
    const result = schema["executeValidate"]("foo" as SourcePath, 9 as any);
    expect(result).toMatchObject({
      foo: [
        {
          value: 9,
        },
      ],
    });
  });

  test("validate: should return errors if src is not a number", () => {
    const schema = number();
    const result = schema["executeValidate"]("foo" as SourcePath, "1" as any);
    expect(result).toMatchObject({
      foo: [
        {
          value: "1",
        },
      ],
    });
  });
});
