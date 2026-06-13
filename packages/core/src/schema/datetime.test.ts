import { SourcePath } from "../val";
import { datetime } from "./datetime";
import { RawString } from "./string";

// Stored datetime values are raw strings; brand them for executeValidate, which
// is typed against the schema's branded source type.
const raw = (value: string): RawString => value as RawString;

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

  test("validate: should return false for a valid ISO datetime string", () => {
    const schema = datetime();
    expect(
      schema["executeValidate"](
        "path" as SourcePath,
        raw("2012-12-12T10:00:00Z"),
      ),
    ).toEqual(false);
  });

  test("validate: should return an error for an invalid ISO datetime string", () => {
    const schema = datetime();
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("not a datetime")),
    ).toEqual({
      path: [
        {
          message: "Value 'not a datetime' is not a valid ISO 8601 datetime",
          value: "not a datetime",
        },
      ],
    });
  });

  test("validate: should return false for null if nullable", () => {
    const schema = datetime().nullable();
    expect(schema["executeValidate"]("path" as SourcePath, null)).toEqual(
      false,
    );
  });

  test("validate: should error if before the from bound", () => {
    const schema = datetime().from("2012-01-01T00:00:00Z");
    expect(
      schema["executeValidate"](
        "path" as SourcePath,
        raw("2011-12-31T23:59:59Z"),
      ),
    ).toEqual({
      path: [
        {
          message:
            "Datetime is before the minimum datetime 2012-01-01T00:00:00Z",
          value: "2011-12-31T23:59:59Z",
        },
      ],
    });
  });

  test("validate: should error if after the to bound", () => {
    const schema = datetime().to("2012-01-01T00:00:00Z");
    expect(
      schema["executeValidate"](
        "path" as SourcePath,
        raw("2012-01-01T00:00:01Z"),
      ),
    ).toEqual({
      path: [
        {
          message:
            "Datetime is after the maximum datetime 2012-01-01T00:00:00Z",
          value: "2012-01-01T00:00:01Z",
        },
      ],
    });
  });

  test("validate: should return false when within from/to bounds", () => {
    const schema = datetime()
      .from("2012-01-01T00:00:00Z")
      .to("2012-12-31T23:59:59Z");
    expect(
      schema["executeValidate"](
        "path" as SourcePath,
        raw("2012-06-15T12:00:00Z"),
      ),
    ).toEqual(false);
  });

  test("validate: should error if src is outside the from/to range", () => {
    const schema = datetime()
      .from("2012-01-01T00:00:00Z")
      .to("2012-12-31T23:59:59Z");
    expect(
      schema["executeValidate"](
        "path" as SourcePath,
        raw("2013-01-01T00:00:00Z"),
      ),
    ).toEqual({
      path: [
        {
          message:
            "Datetime is not between 2012-01-01T00:00:00Z and 2012-12-31T23:59:59Z",
          value: "2013-01-01T00:00:00Z",
        },
      ],
    });
  });

  test("validate: should error if the from bound is not a valid datetime", () => {
    const schema = datetime().from("nonsense");
    expect(
      schema["executeValidate"](
        "path" as SourcePath,
        raw("2012-06-15T12:00:00Z"),
      ),
    ).toEqual({
      path: [
        {
          message: "From datetime 'nonsense' is not a valid ISO 8601 datetime",
          value: "2012-06-15T12:00:00Z",
          typeError: true,
        },
      ],
    });
  });

  test("validate: should error if from is after to", () => {
    const schema = datetime()
      .from("2012-12-31T23:59:59Z")
      .to("2012-01-01T00:00:00Z");
    expect(
      schema["executeValidate"](
        "path" as SourcePath,
        raw("2012-06-15T12:00:00Z"),
      ),
    ).toEqual({
      path: [
        {
          message:
            "From datetime 2012-12-31T23:59:59Z is after to datetime 2012-01-01T00:00:00Z",
          value: "2012-06-15T12:00:00Z",
          typeError: true,
        },
      ],
    });
  });

  test("validate: should run custom validate functions", () => {
    const schema = datetime().validate((src) =>
      src === "2012-12-12T10:00:00Z" ? false : "Must be the canonical datetime",
    );
    expect(
      schema["executeValidate"](
        "path" as SourcePath,
        raw("2012-12-12T10:00:00Z"),
      ),
    ).toEqual(false);
    expect(
      schema["executeValidate"](
        "path" as SourcePath,
        raw("2013-01-01T00:00:00Z"),
      ),
    ).toEqual({
      path: [
        {
          message: "Must be the canonical datetime",
          value: "2013-01-01T00:00:00Z",
        },
      ],
    });
  });
});
