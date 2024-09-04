/* eslint-disable @typescript-eslint/no-explicit-any */
import { SourcePath } from "../val";
import { number } from "./number";
import { object } from "./object";

describe("RecordSchema", () => {
  test("assert: should return success if record is object", () => {
    const schema = object({
      test: number().nullable(),
    }).nullable();
    const src = {
      test: 1,
    };
    expect(schema.assert("foo" as SourcePath, src)).toEqual({
      success: true,
      data: src,
    });
  });

  test("assert: should return errors if record is string", () => {
    const schema = object({
      test: number().nullable(),
    }).nullable();
    const src = "BOOM";
    expect(schema.assert("foo" as SourcePath, src).success).toEqual(false);
  });
});
