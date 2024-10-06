/* eslint-disable @typescript-eslint/no-explicit-any */
import { SourcePath } from "../val";
import { number } from "./number";
import { record } from "./record";

describe("RecordSchema", () => {
  test("assert: ", () => {
    const schema = record(number().nullable());
    const test = schema.assert("foo" as SourcePath, 1);
    if (test.success) {
      test.data;
    }
    expect(schema.assert("foo" as SourcePath, 1)).toEqual({
      success: true,
      data: 1,
    });
  });
});
