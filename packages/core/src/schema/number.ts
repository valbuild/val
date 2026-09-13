import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ItemPreviewInput, PreviewItem, ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

type NumberOptions = {
  max?: number;
  min?: number;
};

export type SerializedNumberSchema = {
  type: "number";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  options?: NumberOptions;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export class NumberSchema<Src extends number | null> extends Schema<Src> {
  constructor(
    private readonly options?: NumberOptions,
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
   * const schema = s.number().describe("How many columns the grid uses");
   * export default c.define("/example.val.ts", schema, 3);
   */
  describe(description: string | null): NumberSchema<Src> {
    return new NumberSchema(
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
   * const schema = s.number().validate((val) =>
   *   Number.isInteger(val) ? false : "Must be a whole number",
   * );
   * export default c.define("/example.val.ts", schema, 3);
   */
  validate(
    validationFunction: (src: Src) => false | string,
  ): NumberSchema<Src> {
    return new NumberSchema(
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
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions, {
        path,
      });
    if (this.opt && (src === null || src === undefined)) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : false;
    }
    if (typeof src !== "number") {
      return {
        [path]: [
          ...customValidationErrors,
          { message: `Expected 'number', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }
    if (this.options?.max && src > this.options.max) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Expected 'number' less than ${this.options.max}`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }
    if (this.options?.min && src < this.options.min) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Expected 'number' greater than ${this.options.min}`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }
    if (customValidationErrors.length > 0) {
      return {
        [path]: customValidationErrors,
      };
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
              message: "Expected 'number', got 'null'",
              typeError: true,
            },
          ],
        },
      };
    }
    if (typeof src === "number") {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
    }
    return {
      success: false,
      errors: {
        [path]: [
          {
            message: `Expected 'number', got '${typeof src}'`,
            typeError: true,
          },
        ],
      },
    };
  }

  nullable(): NumberSchema<Src | null> {
    return new NumberSchema<Src | null>(
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

  readonly(isReadonly: boolean = true): NumberSchema<Src> {
    return new NumberSchema<Src>(
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

  hidden(isHidden: boolean = true): NumberSchema<Src> {
    return new NumberSchema<Src>(
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

  /**
   * Validate that the number is at most `max` (inclusive).
   *
   * @example
   * const schema = s.number().max(4);
   * export default c.define("/example.val.ts", schema, 3);
   */
  max(max: number): NumberSchema<Src> {
    return new NumberSchema<Src>(
      { ...this.options, max },
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
   * Validate that the number is at least `min` (inclusive).
   *
   * @example
   * const schema = s.number().min(1).max(4);
   * export default c.define("/example.val.ts", schema, 3);
   */
  min(min: number): NumberSchema<Src> {
    return new NumberSchema<Src>(
      { ...this.options, min },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
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
   * const schema = s.array(s.number().render({ as: "inline" }));
   * export default c.define("/example.val.ts", schema, [1, 2]);
   */
  render(input: FieldRender): NumberSchema<Src> {
    return new NumberSchema<Src>(
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
   *   s.number().preview(({ val }) => ({ title: String(val) })),
   * );
   * export default c.define("/example.val.ts", schema, [1, 2]);
   */
  preview(select: ItemPreviewInput<Src>): NumberSchema<Src> {
    return new NumberSchema<Src>(
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
      type: "number",
      render: this.renderInput ?? undefined,
      preview: this.previewInput ? true : undefined,
      options: this.options,
      opt: this.opt,
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

export const number = (options?: NumberOptions): NumberSchema<number> => {
  return new NumberSchema(options) as NumberSchema<number>;
};
