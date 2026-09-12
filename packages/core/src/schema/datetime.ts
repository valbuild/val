import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ItemPreviewInput, PreviewItem, ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { SourcePath } from "../val";
import { RawString } from "./string";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

type DateTimeOptions = {
  /**
   * Validate that the datetime is this datetime or after (inclusive).
   *
   * Accepts any ISO 8601 datetime string parseable by `Date.parse`.
   *
   * @example
   * "2021-01-01T00:00:00Z"
   */
  from?: string;
  /**
   * Validate that the datetime is this datetime or before (inclusive).
   *
   * Accepts any ISO 8601 datetime string parseable by `Date.parse`.
   *
   * @example
   * "2021-12-31T23:59:59Z"
   */
  to?: string;
};

export type SerializedDateTimeSchema = {
  type: "dateTime";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  options?: DateTimeOptions;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export class DateTimeSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly options?: DateTimeOptions,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly renderInput: FieldRender | null = null,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
  ) {
    super();
  }

  /**
   * Describe this field.
   *
   * The description is shown next to the field's label in the Val editor, so
   * it is where you say what an editor needs to know but the field name cannot
   * carry. It also travels in the serialized schema, which is what the AI
   * assistant and the MCP tools read.
   *
   * Pass `null` to clear a description set earlier.
   *
   * @example
   * const schema = s.datetime().describe("When the article goes live");
   * export default c.define(
   *   "/example.val.ts",
   *   schema,
   *   "2025-06-01T09:00:00.000Z",
   * );
   */
  describe(description: string | null): DateTimeSchema<Src> {
    return new DateTimeSchema(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
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
   * const schema = s.datetime().validate((val) =>
   *   val.endsWith("Z") ? false : "Must be in UTC",
   * );
   * export default c.define(
   *   "/example.val.ts",
   *   schema,
   *   "2025-06-01T09:00:00.000Z",
   * );
   */
  validate(
    validationFunction: (src: Src) => false | string,
  ): DateTimeSchema<Src> {
    return new DateTimeSchema(
      this.options,
      this.opt,
      [...this.customValidateFunctions, validationFunction],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
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
    const srcMs = Date.parse(src);
    if (Number.isNaN(srcMs)) {
      errors.push({
        message: `Value '${src}' is not a valid ISO 8601 datetime`,
        value: src,
      });
      return { [path]: errors } as ValidationErrors;
    }
    const fromMs =
      this.options?.from !== undefined
        ? Date.parse(this.options.from)
        : undefined;
    const toMs =
      this.options?.to !== undefined ? Date.parse(this.options.to) : undefined;
    if (fromMs !== undefined && Number.isNaN(fromMs)) {
      errors.push({
        message: `From datetime '${this.options?.from}' is not a valid ISO 8601 datetime`,
        value: src,
        typeError: true,
      });
      return { [path]: errors } as ValidationErrors;
    }
    if (toMs !== undefined && Number.isNaN(toMs)) {
      errors.push({
        message: `To datetime '${this.options?.to}' is not a valid ISO 8601 datetime`,
        value: src,
        typeError: true,
      });
      return { [path]: errors } as ValidationErrors;
    }
    if (fromMs !== undefined && toMs !== undefined) {
      if (fromMs > toMs) {
        errors.push({
          message: `From datetime ${this.options?.from} is after to datetime ${this.options?.to}`,
          value: src,
          typeError: true,
        });
      } else if (srcMs < fromMs || srcMs > toMs) {
        errors.push({
          message: `Datetime is not between ${this.options?.from} and ${this.options?.to}`,
          value: src,
        });
      }
    } else if (fromMs !== undefined) {
      if (srcMs < fromMs) {
        errors.push({
          message: `Datetime is before the minimum datetime ${this.options?.from}`,
          value: src,
        });
      }
    } else if (toMs !== undefined) {
      if (srcMs > toMs) {
        errors.push({
          message: `Datetime is after the maximum datetime ${this.options?.to}`,
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
   * Validate that the datetime is this datetime or after (inclusive).
   *
   * Any ISO 8601 datetime string `Date.parse` understands.
   *
   * @example
   * const schema = s.datetime().from("2025-01-01T00:00:00Z");
   * export default c.define(
   *   "/example.val.ts",
   *   schema,
   *   "2025-06-01T09:00:00.000Z",
   * );
   */
  from(from: string): DateTimeSchema<Src> {
    return new DateTimeSchema<Src>(
      { ...this.options, from },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  /**
   * Validate that the datetime is this datetime or before (inclusive).
   *
   * Any ISO 8601 datetime string `Date.parse` understands.
   *
   * @example
   * const schema = s
   *   .datetime()
   *   .from("2025-01-01T00:00:00Z")
   *   .to("2025-12-31T23:59:59Z");
   * export default c.define(
   *   "/example.val.ts",
   *   schema,
   *   "2025-06-01T09:00:00.000Z",
   * );
   */
  to(to: string): DateTimeSchema<Src> {
    return new DateTimeSchema<Src>(
      { ...this.options, to },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  nullable(): DateTimeSchema<Src | null> {
    return new DateTimeSchema<Src | null>(
      this.options,
      true,
      this.customValidateFunctions as CustomValidateFunction<Src | null>[],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  readonly(isReadonly: boolean = true): DateTimeSchema<Src> {
    return new DateTimeSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  hidden(isHidden: boolean = true): DateTimeSchema<Src> {
    return new DateTimeSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      isHidden,
      this.description,
      this.renderInput,
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
   * How this field is laid out in the editor when it is the item of an array
   * or record: `{ as: "inline" }` renders the field itself inside each row,
   * instead of a preview row that navigates to it.
   *
   * Static configuration, not a callback — see `render.ts`.
   *
   * @example
   * const schema = s.array(s.datetime().render({ as: "inline" }));
   * export default c.define("/example.val.ts", schema, [
   *   "2025-06-01T09:00:00.000Z",
   * ]);
   */
  render(input: FieldRender): DateTimeSchema<Src> {
    return new DateTimeSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      input,
      this.previewInput,
    );
  }

  /**
   * How this VALUE is shown where a preview of it is needed — a row in a
   * sortable list, a reference dropdown, a search hit. Never how the field
   * itself is edited (that is `render`). See `preview.ts`.
   *
   * @example
   * const schema = s.array(
   *   s.datetime().preview(({ val }) => ({ title: val })),
   * );
   * export default c.define("/example.val.ts", schema, [
   *   "2025-06-01T09:00:00.000Z",
   * ]);
   */
  preview(select: ItemPreviewInput<Src>): DateTimeSchema<Src> {
    return new DateTimeSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
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
      type: "dateTime",
      render: this.renderInput ?? undefined,
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

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

export const datetime = (
  options?: Record<string, never>,
): DateTimeSchema<RawString> => {
  return new DateTimeSchema(options);
};
