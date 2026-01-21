import { SourcePath } from "../val";
import { number } from "./number";
import { object } from "./object";

describe("ObjectSchema", () => {
  test("assert: should return success if object with keys are correct", () => {
    const schema = object({
      test: number().nullable(),
    }).nullable();
    const src = {
      test: 1,
    };
    expect(schema["executeAssert"]("foo" as SourcePath, src)).toEqual({
      success: true,
      data: src,
    });
  });

  test("assert: should return success even if object has superfluous keys", () => {
    const schema = object({
      test: number().nullable(),
    }).nullable();
    const src = {
      test: null,
      ops: 1,
    };
    expect(schema["executeAssert"]("foo" as SourcePath, src)).toEqual({
      success: true,
      data: src,
    });
  });

  test("assert: should return errors if object is missing keys", () => {
    const schema = object({
      test: number().nullable(),
    }).nullable();
    const src = {
      ops: 1,
    };
    expect(schema["executeAssert"]("foo" as SourcePath, src).success).toEqual(
      false,
    );
  });
});
