/* eslint-disable @typescript-eslint/no-explicit-any */
import { SourcePath } from "../val";
import { number } from "./number";

describe("NumberSchema", () => {
  test("assert: should return true if src is a number", () => {
    const schema = number().nullable();
    const test = schema.assert("foo" as SourcePath, 1);
    if (test.success) {
      test.data;
    }
    expect(schema.assert("foo" as SourcePath, 1)).toEqual({
      success: true,
      data: 1,
    });
  });
  test("assert: should return false if src is a string", () => {
    const schema = number();
    expect(schema.assert("foo" as SourcePath, "1" as any).success).toEqual(
      false,
    );
  });
});
