/* eslint-disable @typescript-eslint/no-explicit-any */
import { SourcePath } from "../val";
import { initVal } from "../initVal";
import { deserializeSchema } from "./deserialize";
import { number } from "./number";

describe("NumberSchema", () => {
  test("assert: should return success if src is a number", () => {
    const schema = number().nullable();
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

describe("bounds of 0", () => {
  // `.max(0)` and `.min(0)` were read as "no bound" because the check was
  // `options.max && ...`, and 0 is falsy.
  test("max(0) rejects a positive number", () => {
    const schema = number().max(0);
    expect(
      schema["executeValidate"]("foo" as SourcePath, 1 as any),
    ).toMatchObject({ foo: [{ message: "Must be at most 0", value: 1 }] });
  });
  test("min(0) rejects a negative number", () => {
    const schema = number().min(0);
    expect(
      schema["executeValidate"]("foo" as SourcePath, -1 as any),
    ).toMatchObject({ foo: [{ message: "Must be at least 0", value: -1 }] });
  });
  test("min(0) accepts 0", () => {
    const schema = number().min(0).max(0);
    expect(schema["executeValidate"]("foo" as SourcePath, 0 as any)).toBe(
      false,
    );
  });
});

describe("s.int()", () => {
  const { s, c } = initVal();

  test("is a number schema, serialized with integer: true", () => {
    const serialized = s.int()["executeSerialize"]();
    expect(serialized).toMatchObject({
      type: "number",
      options: { integer: true },
    });
  });

  test("accepts a whole number and rejects a decimal", () => {
    const schema = s.int();
    expect(schema["executeValidate"]("foo" as SourcePath, 3)).toBe(false);
    expect(schema["executeValidate"]("foo" as SourcePath, 3.5)).toMatchObject({
      foo: [{ message: "Must be a whole number", value: 3.5 }],
    });
  });

  test("reports every broken rule, not only the first", () => {
    const schema = s.int().max(10);
    const result = schema["executeValidate"]("foo" as SourcePath, 10.5);
    expect(result).toMatchObject({
      foo: [
        { message: "Must be at most 10" },
        { message: "Must be a whole number" },
      ],
    });
  });

  test("is defined like any other schema", () => {
    const module = c.define("/int.val.ts", s.object({ n: s.int() }), { n: 1 });
    expect(module).toBeDefined();
  });
});

describe("step", () => {
  const { s } = initVal();

  test("is counted from min", () => {
    const schema = s.int().min(1).step(2);
    expect(schema["executeValidate"]("foo" as SourcePath, 5)).toBe(false);
    expect(schema["executeValidate"]("foo" as SourcePath, 4)).toMatchObject({
      foo: [{ message: "Must be a multiple of 2, counted from 1", value: 4 }],
    });
  });

  test("is counted from 0 when there is no min", () => {
    const schema = s.int().step(5);
    expect(schema["executeValidate"]("foo" as SourcePath, -15)).toBe(false);
    expect(schema["executeValidate"]("foo" as SourcePath, 42)).toMatchObject({
      foo: [{ message: "Must be a multiple of 5, counted from 0" }],
    });
  });

  test("works on decimals despite floating point", () => {
    const schema = s.number().step(0.1);
    expect(schema["executeValidate"]("foo" as SourcePath, 0.3)).toBe(false);
    expect(schema["executeValidate"]("foo" as SourcePath, 0.7)).toBe(false);
    expect(schema["executeValidate"]("foo" as SourcePath, 0.75)).not.toBe(
      false,
    );
  });

  test("is serialized in the options", () => {
    expect(s.int().min(0).step(5)["executeSerialize"]()).toMatchObject({
      options: { integer: true, min: 0, step: 5 },
    });
  });

  test("must be above 0", () => {
    expect(() => s.int().step(0)).toThrow(/above 0/);
    expect(() => s.number().step(-1)).toThrow(/above 0/);
  });

  test("of an int must be whole", () => {
    expect(() => s.int().step(0.5)).toThrow(/whole number/);
  });
});

describe('render({ as: "slider" })', () => {
  const { s } = initVal();

  test("is serialized verbatim", () => {
    const serialized = s
      .int()
      .render({ as: "slider", min: 0, max: 100, step: 5 })
      ["executeSerialize"]();
    expect(serialized).toMatchObject({
      type: "number",
      render: { as: "slider", min: 0, max: 100, step: 5 },
    });
  });

  test("survives the methods chained after it", () => {
    const serialized = s
      .int()
      .render({ as: "slider", min: 0, max: 10 })
      .describe("desc")
      .min(0)
      .max(10)
      .step(1)
      .nullable()
      .readonly()
      .hidden()
      .validate(() => false)
      .preview(({ val }) => ({ title: String(val) }))
      ["executeSerialize"]();
    expect(serialized).toMatchObject({
      render: { as: "slider", min: 0, max: 10 },
      description: "desc",
    });
  });

  test("a second render replaces the first", () => {
    const serialized = s
      .int()
      .render({ as: "slider", min: 0, max: 10 })
      .render({ as: "slider", min: 0, max: 5 })
      ["executeSerialize"]();
    expect(serialized).toMatchObject({
      render: { as: "slider", min: 0, max: 5 },
    });
  });

  test("round-trips through deserialize", () => {
    const serialized = s
      .int()
      .min(0)
      .max(100)
      .step(5)
      .render({ as: "slider", min: 0, max: 100 })
      ["executeSerialize"]();
    expect(deserializeSchema(serialized)["executeSerialize"]()).toEqual(
      serialized,
    );
  });

  test("is not validation: a value outside the slider is still valid", () => {
    const schema = s.int().render({ as: "slider", min: 0, max: 100 });
    expect(schema["executeValidate"]("foo" as SourcePath, 150)).toBe(false);
  });

  describe("throws when the slider could produce a value the schema rejects", () => {
    test("min not below max", () => {
      expect(() => s.int().render({ as: "slider", min: 10, max: 10 })).toThrow(
        /min must be below its max/,
      );
    });
    test("slider below the schema's min", () => {
      expect(() =>
        s.int().min(5).render({ as: "slider", min: 0, max: 10 }),
      ).toThrow(/slider's min 0 is below the schema's min 5/);
    });
    test("slider above the schema's max, whichever is chained first", () => {
      expect(() =>
        s.int().max(50).render({ as: "slider", min: 0, max: 100 }),
      ).toThrow(/slider's max 100 is above the schema's max 50/);
      expect(() =>
        s.int().render({ as: "slider", min: 0, max: 100 }).max(50),
      ).toThrow(/slider's max 100 is above the schema's max 50/);
    });
    test("decimals on an int", () => {
      expect(() =>
        s.int().render({ as: "slider", min: 0, max: 1, step: 0.1 }),
      ).toThrow(/step 0.1 must be a whole number/);
      expect(() => s.int().render({ as: "slider", min: 0.5, max: 10 })).toThrow(
        /min 0.5 must be a whole number/,
      );
    });
    test("a slider step that is not a multiple of the schema's", () => {
      expect(() =>
        s.int().step(5).render({ as: "slider", min: 0, max: 100, step: 2 }),
      ).toThrow(/step 2 must be a multiple of the schema's step 5/);
    });
    test("a slider min off the schema's grid", () => {
      expect(() =>
        s.int().step(5).render({ as: "slider", min: 3, max: 100 }),
      ).toThrow(/min 3 is not one of the schema's steps/);
    });
    test("a step of 0", () => {
      expect(() =>
        s.number().render({ as: "slider", min: 0, max: 1, step: 0 }),
      ).toThrow(/step must be above 0/);
    });
  });

  test("a slider on s.number() may use decimals", () => {
    expect(() =>
      s.number().render({ as: "slider", min: 0, max: 1, step: 0.1 }),
    ).not.toThrow();
  });

  test("a slider whose step is a multiple of the schema's is fine", () => {
    expect(() =>
      s.int().min(1).step(2).render({ as: "slider", min: 3, max: 9, step: 4 }),
    ).not.toThrow();
  });
});
