import { SourcePath } from "../val";
import { datetime } from "./datetime";

describe("DateTimeSchema", () => {
  test("assert: should return success if src is an ISO datetime string", () => {
    const schema = datetime();
    expect(
      schema["executeAssert"]("path" as SourcePath, "2012-12-12T10:00:00Z"),
    ).toEqual({
      success: true,
      data: "2012-12-12T10:00:00Z",
    });
  });

  test("assert: should return success if src is any string (validation happens elsewhere)", () => {
    const schema = datetime();
    expect(
      schema["executeAssert"]("path" as SourcePath, "something else"),
    ).toEqual({
      success: true,
      data: "something else",
    });
  });

  test("assert: should return type error if src is null and not optional", () => {
    const schema = datetime();
    expect(schema["executeAssert"]("path" as SourcePath, null)).toEqual({
      success: false,
      errors: {
        path: [
          {
            message: "Expected 'string', got 'null'",
            typeError: true,
          },
        ],
      },
    });
  });

  test("assert: should return success for null if nullable", () => {
    const schema = datetime().nullable();
    expect(schema["executeAssert"]("path" as SourcePath, null)).toEqual({
      success: true,
      data: null,
    });
  });

  test("assert: should return type error if src is not a string", () => {
    const schema = datetime();
    expect(schema["executeAssert"]("path" as SourcePath, 42)).toEqual({
      success: false,
      errors: {
        path: [
          {
            message: "Expected 'string', got 'number'",
            typeError: true,
          },
        ],
      },
    });
  });
});
