import {
  AssertError,
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
} from ".";
import { ItemPreviewInput, PreviewItem, ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedEnumSchema = {
  type: "enum";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  /**
   * Every value this field may take, in declaration order — which is the order
   * the editor's dropdown offers them in.
   */
  values: string[];
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

/**
 * One of a fixed set of strings.
 *
 * The values are the schema — there are no member schemas to descend into, so
 * this is a LEAF, like `s.string()` with a closed domain. That is the whole
 * difference from {@link DiscriminatedUnionSchema}, and the reason the two are
 * separate: everything that walks a schema tree has to recurse into a
 * discriminated union's variants and must not try to recurse into these.
 */
export class EnumSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly values: readonly string[],
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
   * The description is shown next to the field's label in the Val editor, so it is
   * where you say what an editor needs to know but the field name cannot carry. It
   * also travels in the serialized schema, which is what the AI assistant and the
   * MCP tools read.
   *
   * Pass `null` to clear a description set earlier.
   *
   * @example
   * const schema = s
   *   .enum("draft", "published")
   *   .describe("Only published pages are built");
   * export default c.define("/example.val.ts", schema, "draft");
   */
  describe(description: string | null): EnumSchema<Src> {
    return new EnumSchema<Src>(
      this.values,
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
   * Validation runs in the Studio as you type, in `npx val validate` and before a
   * publish.
   *
   * @example
   * const schema = s
   *   .enum("draft", "published")
   *   .validate((val) =>
   *     val === "published" ? "Publishing is frozen this week" : false,
   *   );
   * export default c.define("/example.val.ts", schema, "draft");
   */
  validate(validationFunction: (src: Src) => false | string): EnumSchema<Src> {
    return new EnumSchema<Src>(
      this.values,
      this.opt,
      this.customValidateFunctions.concat(validationFunction),
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
    // The custom validators always report, whatever the structural answer is.
    const errors: ValidationError[] = customValidationErrors;
    const unknownSrc = src as unknown;
    if (this.opt && (unknownSrc === null || unknownSrc === undefined)) {
      return errors.length > 0 ? { [path]: errors } : false;
    }
    if (!Array.isArray(this.values) || this.values.length === 0) {
      errors.push({
        message: `An enum schema must have at least one value`,
        schemaError: true,
      });
    } else if (typeof unknownSrc !== "string") {
      errors.push({
        message: `Expected 'string', got '${
          unknownSrc === null ? "null" : typeof unknownSrc
        }'`,
        value: src,
        typeError: true,
      });
    } else if (!this.values.includes(unknownSrc)) {
      errors.push({
        message: `Value must be one of the following: ${this.values
          .map((value) => `"${value}"`)
          .join(", ")}`,
        value: src,
      });
    }
    return errors.length > 0 ? { [path]: errors } : false;
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
    const errors: Record<SourcePath, AssertError[]> = {};
    if (typeof src !== "string") {
      errors[path] = [
        {
          message: `Expected 'string', got '${src === null ? "null" : typeof src}'`,
          typeError: true,
        },
      ];
      return { success: false, errors };
    }
    if (!Array.isArray(this.values) || this.values.length === 0) {
      errors[path] = [
        {
          message: `An enum schema must have at least one value`,
          schemaError: true,
        },
      ];
      return { success: false, errors };
    }
    if (!this.values.includes(src)) {
      errors[path] = [
        {
          message: `Expected one of ${this.values
            .map((value) => `'${value}'`)
            .join(", ")}, got '${src}'`,
          typeError: true,
        },
      ];
      return { success: false, errors };
    }
    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  nullable(): EnumSchema<Src | null> {
    // Explicit type args: `previewInput` would otherwise pin inference to `Src`.
    return new EnumSchema<Src | null>(
      this.values,
      true,
      this.customValidateFunctions as CustomValidateFunction<Src | null>[],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  readonly(isReadonly: boolean = true): EnumSchema<Src> {
    return new EnumSchema<Src>(
      this.values,
      this.opt,
      this.customValidateFunctions,
      isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  hidden(isHidden: boolean = true): EnumSchema<Src> {
    return new EnumSchema<Src>(
      this.values,
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
   * const schema = s.array(
   *   s.enum("draft", "published").render({ as: "inline" }),
   * );
   * export default c.define("/example.val.ts", schema, ["draft"]);
   */
  render(input: FieldRender): EnumSchema<Src> {
    return new EnumSchema<Src>(
      this.values,
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
   *   s.enum("draft", "published").preview(({ val }) => ({ title: val })),
   * );
   * export default c.define("/example.val.ts", schema, ["draft"]);
   */
  preview(select: ItemPreviewInput<Src>): EnumSchema<Src> {
    return new EnumSchema<Src>(
      this.values,
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

  protected executeSerialize(): SerializedEnumSchema {
    return {
      type: "enum",
      render: this.renderInput ?? undefined,
      preview: this.previewInput ? true : undefined,
      values: [...this.values],
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
    // A leaf: nothing below it to preview.
    return {};
  }
}

/**
 * Define a string that must be one of a fixed set of values.
 *
 * Named `enumSchema` rather than `enum` because `enum` is a reserved word and
 * cannot be a binding name; it is exposed as `s.enum`.
 */
export const enumSchema = <T extends string>(
  ...values: [T, ...T[]]
): EnumSchema<T> => {
  return new EnumSchema<T>(values);
};
