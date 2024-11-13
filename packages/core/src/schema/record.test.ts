/* eslint-disable @typescript-eslint/no-explicit-any */
import { SourcePath } from "../val";
import { number } from "./number";
import { record } from "./record";

describe("RecordSchema", () => {
  test("assert: basic record", () => {
    const schema = record(number().nullable());
    expect(schema.assert("foo" as SourcePath, { bar: 1 })).toEqual({
      success: true,
      data: { bar: 1 },
    });
  });
});
