import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ItemPreviewInput, PreviewItem } from "../preview";
import { SourcePath } from "../val";
import { RawString } from "./string";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

type DateOptions = {
  /**
   * Validate that the date is this date or after (inclusive).
   *
   * @example
   * "2021-01-01"
   */
  from?: string;
  /**
   * Validate that the date is this date or before (inclusive).
   *
   * @example
   * "2021-01-01"
   */
  to?: string;
};

export type SerializedDateSchema = {
  type: "date";
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  options?: DateOptions;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export class DateSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly options?: DateOptions,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
  ) {
    super();
  }

  /**
   * Describe this field.
   *
   * The description is INPUT HELP: it is shown where this field's value is
   * entered — beside its input in the Val editor, and for a record's key
   * schema in every form that asks for a key — so it is where you say what an
   * editor needs to know to fill it in RIGHT, which the field name cannot
   * carry. It is not a name for the value: that is `.preview(...)`, and it is
   * read somewhere else. The description also travels in the serialized
   * schema, which is what the AI assistant and the MCP tools read.
   *
   * Pass `null` to clear a description set earlier.
   *
   * @example
   * const schema = s.date().describe("First day the campaign is live");
   * export default c.define("/example.val.ts", schema, "2025-06-01");
   */
  describe(description: string | null): DateSchema<Src> {
    return new DateSchema(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.previewInput,
    );
  }

  /**
   * Add a custom validation rule to this field.
   *
   * The function is called with the field's value and returns `false` when the
   * value is fine, or a STRING with the message to show when it is not. Call it
   * more than once to add more rules — they all run, and every message is
   * reported.
   *
   * Write the check as a ternary, not as `ok || "message"`: that returns `true`
   * when the value is fine, and `true` is not one of the two answers.
   *
   * Validation runs in the Studio as you type, in `npx val validate` and
   * before a publish.
   *
   * @example
   * const schema = s.date().validate((val) =>
   *   val >= "2025-01-01" ? false : "Must be in 2025 or later",
   * );
   * export default c.define("/example.val.ts", schema, "2025-06-01");
   */
  validate(validationFunction: (src: Src) => false | string): DateSchema<Src> {
    return new DateSchema(
      this.options,
      this.opt,
      [...this.customValidateFunctions, validationFunction],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const errors: ValidationError[] = this.executeCustomValidateFunctions(
      src,
      this.customValidateFunctions,
      { path },
    );
    if (this.opt && (src === null || src === undefined)) {
      return errors.length > 0 ? { [path]: errors } : false;
    }
    if (typeof src !== "string") {
      errors.push({
        message: `Expected 'string', got '${typeof src}'`,
        value: src,
      });
      return { [path]: errors } as ValidationErrors;
    }
    // The bounds below are compared as strings, which only orders days when
    // every side is a real `YYYY-MM-DD`: "19f81-12-30" sorts between
    // "1900-01-01" and "2024-01-01" and would pass them.
    if (!isCalendarDay(src)) {
      errors.push({
        message: `Value '${src}' is not a valid date (expected YYYY-MM-DD)`,
        value: src,
      });
      return { [path]: errors } as ValidationErrors;
    }
    const bounds: [label: string, bound: string | undefined][] = [
      ["From", this.options?.from],
      ["To", this.options?.to],
    ];
    for (const [name, bound] of bounds) {
      if (bound !== undefined && !isCalendarDay(bound)) {
        errors.push({
          message: `${name} date '${bound}' is not a valid date (expected YYYY-MM-DD)`,
          value: src,
          typeError: true,
        });
        return { [path]: errors } as ValidationErrors;
      }
    }
    if (this.options?.from && this.options?.to) {
      if (this.options.from > this.options.to) {
        errors.push({
          message: `From date ${this.options.from} is after to date ${this.options.to}`,
          value: src,
          typeError: true,
        });
      } else if (src < this.options.from || src > this.options.to) {
        errors.push({
          message: `Date is not between ${this.options.from} and ${this.options.to}`,
          value: src,
        });
      }
    } else if (this.options?.from) {
      if (src < this.options.from) {
        errors.push({
          message: `Date is before the minimum date ${this.options.from}`,
          value: src,
        });
      }
    } else if (this.options?.to) {
      if (src > this.options.to) {
        errors.push({
          message: `Date is after the maximum date ${this.options.to}`,
          value: src,
        });
      }
    }
    if (errors.length > 0) {
      return { [path]: errors } as ValidationErrors;
    }
    return false;
  }

  protected executeAssert(
    path: SourcePath,
    src: unknown,
  ): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
    }
    if (src === null) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: "Expected 'string', got 'null'",
              typeError: true,
            },
          ],
        },
      };
    }
    if (typeof src !== "string") {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Expected 'string', got '${typeof src}'`,
              typeError: true,
            },
          ],
        },
      };
    }

    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  /**
   * Validate that the date is this date or after (inclusive).
   *
   * Written as `YYYY-MM-DD`, the same shape the value has.
   *
   * @example
   * const schema = s.date().from("2025-01-01");
   * export default c.define("/example.val.ts", schema, "2025-06-01");
   */
  from(from: string): DateSchema<Src> {
    return new DateSchema<Src>(
      { ...this.options, from },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
    );
  }

  /**
   * Validate that the date is this date or before (inclusive).
   *
   * Written as `YYYY-MM-DD`, the same shape the value has.
   *
   * @example
   * const schema = s.date().from("2025-01-01").to("2025-12-31");
   * export default c.define("/example.val.ts", schema, "2025-06-01");
   */
  to(to: string): DateSchema<Src> {
    return new DateSchema<Src>(
      { ...this.options, to },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
    );
  }

  nullable(): DateSchema<Src | null> {
    return new DateSchema<Src | null>(
      this.options,
      true,
      this.customValidateFunctions as CustomValidateFunction<Src | null>[],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
    );
  }

  readonly(isReadonly: boolean = true): DateSchema<Src> {
    return new DateSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
    );
  }

  hidden(isHidden: boolean = true): DateSchema<Src> {
    return new DateSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      isHidden,
      this.description,
      this.previewInput,
    );
  }

  protected override executeCustomValidateAt(
    path: SourcePath,
    src: Src,
  ): ValidationError[] {
    return this.executeCustomValidateFunctions(
      src,
      this.customValidateFunctions,
      { path },
    );
  }

  /**
   * How this VALUE is shown where a preview of it is needed — a row in a
   * sortable list, a reference dropdown, a search hit. Never how the field
   * itself is edited (that is `render`). See `preview.ts`.
   *
   * @example
   * const schema = s.array(
   *   s.date().preview(({ val }) => ({ title: val })),
   * );
   * export default c.define("/example.val.ts", schema, ["2025-06-01"]);
   */
  preview(select: ItemPreviewInput<Src>): DateSchema<Src> {
    return new DateSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      select,
    );
  }

  protected override executePreviewItem(
    src: NonNullable<Src>,
  ): PreviewItem | null {
    if (this.previewInput === null) {
      return null;
    }
    return this.previewInput({ val: src });
  }

  protected override declaresItemPreview(): boolean {
    return this.previewInput !== null;
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "date",
      preview: this.previewInput ? true : undefined,
      opt: this.opt,
      options: this.options,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether `value` is a `YYYY-MM-DD` day that exists on the calendar — so
 * "2023-02-29" and "2024-13-01" are not, even though they have the shape.
 */
function isCalendarDay(value: string): boolean {
  const match = CALENDAR_DAY.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Out-of-range fields roll over (Feb 30 -> Mar 2) instead of failing, so a
  // day is real only if it survives the round trip. setUTCFullYear, not
  // Date.UTC: the latter maps years 0-99 to 1900-1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const date = (
  options?: Record<string, never>,
): DateSchema<RawString> => {
  return new DateSchema(options);
};
