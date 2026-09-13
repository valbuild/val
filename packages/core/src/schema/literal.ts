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

export type SerializedLiteralSchema = {
  type: "literal";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  value: string;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export class LiteralSchema<Src extends string | null> extends Schema<Src> {
  /** Type-only marker: as a record key, this declares the key set. See `LocaleSchema`. */
  declare readonly __declaresRecordKeys: true;

  constructor(
    private readonly value: string,
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
   * const schema = s
   *   .literal("hero")
   *   .describe("The block type — it identifies the variant");
   * export default c.define("/example.val.ts", schema, "hero");
   */
  describe(description: string | null): LiteralSchema<Src> {
    return new LiteralSchema(
      this.value,
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
   * const schema = s.literal("hero").validate((val) =>
   *   val === "hero" ? false : "Unknown block type",
   * );
   * export default c.define("/example.val.ts", schema, "hero");
   */
  validate(
    validationFunction: (src: Src) => false | string,
  ): LiteralSchema<Src> {
    return new LiteralSchema(
      this.value,
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
    if (typeof src !== "string") {
      return {
        [path]: [
          ...customValidationErrors,
          { message: `Expected 'string', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }
    if (src !== this.value) {
      return {
        [path]: [
          ...customValidationErrors,
          {
            message: `Expected literal '${this.value}', got '${src}'`,
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
              message: `Expected 'string', got 'null'`,
              typeError: true,
            },
          ],
        },
      };
    }
    if (typeof src === "string" && src === this.value) {
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
            message: `Expected literal '${this.value}', got '${src}'`,
            typeError: true,
          },
        ],
      },
    };
  }

  nullable(): LiteralSchema<Src | null> {
    return new LiteralSchema<Src | null>(
      this.value,
      true,
      this.customValidateFunctions as CustomValidateFunction<Src | null>[],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  readonly(isReadonly: boolean = true): LiteralSchema<Src> {
    return new LiteralSchema<Src>(
      this.value,
      this.opt,
      this.customValidateFunctions,
      isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  hidden(isHidden: boolean = true): LiteralSchema<Src> {
    return new LiteralSchema<Src>(
      this.value,
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
   * const schema = s.array(s.literal("hero").render({ as: "inline" }));
   * export default c.define("/example.val.ts", schema, ["hero"]);
   */
  render(input: FieldRender): LiteralSchema<Src> {
    return new LiteralSchema(
      this.value,
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
   *   s.literal("hero").preview(({ val }) => ({ title: val })),
   * );
   * export default c.define("/example.val.ts", schema, ["hero"]);
   */
  preview(select: ItemPreviewInput<Src>): LiteralSchema<Src> {
    return new LiteralSchema(
      this.value,
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
      type: "literal",
      render: this.renderInput ?? undefined,
      preview: this.previewInput ? true : undefined,
      value: this.value,
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

export const literal = <T extends string>(value: T): LiteralSchema<T> => {
  return new LiteralSchema(value);
};
