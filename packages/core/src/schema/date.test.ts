import { SourcePath } from "../val";
import { date } from "./date";

describe("DateSchema", () => {
  test("assert: should return success if src is a string", () => {
    const schema = date();
    expect(schema["executeAssert"]("path" as SourcePath, "2012-12-12")).toEqual(
      {
        success: true,
        data: "2012-12-12",
      },
    );
  });

  test("assert: should return success if src is a date / string", () => {
    const schema = date();
    expect(
      schema["executeAssert"]("path" as SourcePath, "something else"),
    ).toEqual({
      success: true,
      data: "something else",
    });
  });
});
