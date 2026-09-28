import { SourcePath } from "../val";
import { date } from "./date";
import { RawString } from "./string";

// Stored date values are raw strings; brand them for executeValidate, which is
// typed against the schema's branded source type.
const raw = (value: string): RawString => value as RawString;

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

  test("validate: should return false for a value within bounds", () => {
    const schema = date().from("2012-01-01").to("2012-12-31");
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("2012-06-15")),
    ).toEqual(false);
  });

  test("validate: should error if before the from bound", () => {
    const schema = date().from("2012-01-01");
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("2011-12-31")),
    ).toEqual({
      path: [
        {
          message: "Date is before the minimum date 2012-01-01",
          value: "2011-12-31",
        },
      ],
    });
  });

  test("validate: should error if after the to bound", () => {
    const schema = date().to("2012-12-31");
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("2013-01-01")),
    ).toEqual({
      path: [
        {
          message: "Date is after the maximum date 2012-12-31",
          value: "2013-01-01",
        },
      ],
    });
  });

  test("validate: should error if src is outside the from/to range", () => {
    const schema = date().from("2012-01-01").to("2012-12-31");
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("2013-01-01")),
    ).toEqual({
      path: [
        {
          message: "Date is not between 2012-01-01 and 2012-12-31",
          value: "2013-01-01",
        },
      ],
    });
  });

  test("validate: should error if from is after to", () => {
    const schema = date().from("2012-12-31").to("2012-01-01");
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("2012-06-15")),
    ).toEqual({
      path: [
        {
          message: "From date 2012-12-31 is after to date 2012-01-01",
          value: "2012-06-15",
          typeError: true,
        },
      ],
    });
  });

  test("validate: should run custom validate functions", () => {
    const schema = date().validate((src) =>
      src === "2012-12-12" ? false : "Must be the canonical date",
    );
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("2012-12-12")),
    ).toEqual(false);
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("2013-01-01")),
    ).toEqual({
      path: [
        {
          message: "Must be the canonical date",
          value: "2013-01-01",
        },
      ],
    });
  });
});

describe("DateSchema: shape", () => {
  test.each([
    "19f81-12-30",
    "1981-12-30foo",
    "1981-1-30",
    "81-12-30",
    "1981-12-30T00:00:00Z",
    "2023-02-29",
    "2024-13-01",
    "2024-04-31",
    "",
  ])("validate: should error on '%s'", (value) => {
    const schema = date().from("1900-01-01").to("2024-01-01");
    expect(schema["executeValidate"]("path" as SourcePath, raw(value))).toEqual(
      {
        path: [
          {
            message: `Value '${value}' is not a valid date (expected YYYY-MM-DD)`,
            value,
          },
        ],
      },
    );
  });

  test.each(["1981-12-30", "2024-02-29", "0050-01-01", "9999-12-31"])(
    "validate: should accept '%s'",
    (value) => {
      expect(
        date()["executeValidate"]("path" as SourcePath, raw(value)),
      ).toEqual(false);
    },
  );

  test("validate: should allow null when nullable", () => {
    expect(
      date()
        .nullable()
        ["executeValidate"]("path" as SourcePath, null),
    ).toEqual(false);
  });

  test("validate: should error if a bound is not a date", () => {
    const schema = date().from("2012-1-1");
    expect(
      schema["executeValidate"]("path" as SourcePath, raw("2012-06-15")),
    ).toEqual({
      path: [
        {
          message:
            "From date '2012-1-1' is not a valid date (expected YYYY-MM-DD)",
          value: "2012-06-15",
          typeError: true,
        },
      ],
    });
  });
});
