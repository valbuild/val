import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { ItemPreviewInput, PreviewItem, ReifiedPreview } from "../preview";
import { FieldRender } from "../render";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

type StringOptions = {
  maxLength?: number;
  minLength?: number;
  regexp?: RegExp;
  regExpMessage?: string;
};

export type SerializedStringSchema = {
  type: "string";
  /**
   * How this field is laid out in the editor, carried WHOLE rather than as a
   * marker.
   *
   * A render is static configuration — no closure, no dependency on source — so
   * unlike a `preview` it serializes in full, and the editor reads it straight
   * off the schema it already has. See `render.ts` for what that assumption
   * buys, and what to do if a render ever needs to stop being static.
   */
  render?: FieldRender;
  /**
   * Set by `.multiline()`: the field is a growing text box rather than a
   * single-line input.
   *
   * A property of the schema rather than a `render` variant, because it says
   * what the string IS — text that may hold line breaks — and not merely how one
   * field is drawn. It is read the same way a render is, straight off the
   * serialized schema where the field is drawn.
   */
  multiline?: boolean;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  options?: {
    maxLength?: number;
    minLength?: number;
    regexp?: {
      message?: string;
      source: string;
      flags: string;
    };
    customValidate?: boolean;
  };
  opt: boolean;
  raw: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

const brand = Symbol("string");
export type RawString = string & { readonly [brand]: "raw" };

export class StringSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly options?: StringOptions,
    private readonly opt: boolean = false,
    private readonly isRaw: boolean = false,
    private readonly customValidateFunctions: ((
      src: Src,
    ) => false | string)[] = [],
    private readonly renderInput: FieldRender | null = null,
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
    private readonly isMultiline: boolean = false,
  ) {
    super();
  }

  describe(description: string | null): StringSchema<Src> {
    return new StringSchema<Src>(
      this.options,
      this.opt,
      this.isRaw,
      this.customValidateFunctions,
      this.renderInput,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.previewInput,
      this.isMultiline,
    );
  }

  /**
   * @deprecated Use `minLength` instead
   */
  min(minLength: number): StringSchema<Src> {
    return this.minLength(minLength);
  }

  minLength(minLength: number): StringSchema<Src> {
    return new StringSchema<Src>(
      { ...this.options, minLength },
      this.opt,
      this.isRaw,
      this.customValidateFunctions,
      this.renderInput,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.isMultiline,
    );
  }

  /**
   * @deprecated Use `maxLength` instead
   */
  max(maxLength: number): StringSchema<Src> {
    return this.maxLength(maxLength);
  }

  maxLength(maxLength: number): StringSchema<Src> {
    return new StringSchema<Src>(
      { ...this.options, maxLength },
      this.opt,
      this.isRaw,
      this.customValidateFunctions,
      this.renderInput,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.isMultiline,
    );
  }

  regexp(regexp: RegExp, message?: string): StringSchema<Src> {
    return new StringSchema<Src>(
      { ...this.options, regexp, regExpMessage: message },
      this.opt,
      this.isRaw,
      this.customValidateFunctions,
      this.renderInput,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.isMultiline,
    );
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): StringSchema<Src> {
    return new StringSchema<Src>(
      this.options,
      this.opt,
      this.isRaw,
      this.customValidateFunctions.concat(validationFunction),
      this.renderInput,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.isMultiline,
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
    if (!this.opt && (src === null || src === undefined)) {
      return {
        [path]: [
          {
            message: `Expected 'string', got '${src === null ? "null" : "undefined"}'`,
            value: src,
          },
        ],
      } as ValidationErrors;
    }
    if (typeof src !== "string") {
      return {
        [path]: [
          { message: `Expected 'string', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }
    if (this.options?.maxLength && src.length > this.options.maxLength) {
      errors.push({
        message: `Expected string to be at most ${this.options.maxLength} characters long, got ${src.length}`,
        value: src,
      });
    }
    if (this.options?.minLength && src.length < this.options.minLength) {
      errors.push({
        message: `Expected string to be at least ${this.options.minLength} characters long, got ${src.length}`,
        value: src,
      });
    }
    if (this.options?.regexp && !this.options.regexp.test(src)) {
      errors.push({
        message:
          this.options.regExpMessage ||
          `Expected string to match reg exp: ${this.options.regexp.toString()}, got '${src}'`,
        value: src,
      });
    }
    if (errors.length > 0) {
      return {
        [path]: errors,
      } as ValidationErrors;
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
    if (typeof src === "string") {
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
            message: `Expected 'string', got '${typeof src}'`,
            typeError: true,
          },
        ],
      },
    };
  }

  nullable(): StringSchema<Src | null> {
    return new StringSchema(
      this.options,
      true,
      this.isRaw,
      this.customValidateFunctions,
      this.renderInput,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.isMultiline,
    ) as unknown as StringSchema<Src | null>;
  }

  readonly(isReadonly: boolean = true): StringSchema<Src> {
    return new StringSchema<Src>(
      this.options,
      this.opt,
      this.isRaw,
      this.customValidateFunctions,
      this.renderInput,
      isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.isMultiline,
    );
  }

  hidden(isHidden: boolean = true): StringSchema<Src> {
    return new StringSchema<Src>(
      this.options,
      this.opt,
      this.isRaw,
      this.customValidateFunctions,
      this.renderInput,
      this.isReadonly,
      isHidden,
      this.description,
      this.previewInput,
      this.isMultiline,
    );
  }

  raw(): StringSchema<Src extends null ? RawString | null : RawString> {
    return new StringSchema(
      this.options,
      this.opt,
      true,
      this.customValidateFunctions,
      this.renderInput,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.isMultiline,
    ) as unknown as StringSchema<
      Src extends null ? RawString | null : RawString
    >;
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

  protected executeSerialize(): SerializedSchema {
    return {
      type: "string",
      render: this.renderInput ?? undefined,
      multiline: this.isMultiline ? true : undefined,
      preview: this.previewInput ? true : undefined,
      options: {
        maxLength: this.options?.maxLength,
        minLength: this.options?.minLength,
        regexp: this.options?.regexp && {
          message: this.options.regExpMessage,
          source: this.options.regexp.source,
          flags: this.options.regexp.flags,
        },
        customValidate:
          this.customValidateFunctions &&
          this.customValidateFunctions?.length > 0,
      },
      opt: this.opt,
      raw: this.isRaw,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    };
  }

  /**
   * This string holds text that may run to several lines: the editor gives it a
   * growing text box instead of a single-line input.
   *
   * Nothing else changes — the value is still a plain string, and no validation
   * is added or removed. For code, use `s.code({ language })` instead, which is
   * its own schema type.
   *
   * @example
   * const schema = s.string().multiline();
   * export default c.define("/example.val.ts", schema, "Line one\nLine two");
   */
  multiline(): StringSchema<Src> {
    return new StringSchema<Src>(
      this.options,
      this.opt,
      this.isRaw,
      this.customValidateFunctions,
      this.renderInput,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      true,
    );
  }

  /**
   * How this field is laid out in the editor when it is the item of an array or
   * record: `{ as: "inline" }` renders the field itself inside each row,
   * instead of a preview row that navigates to it.
   *
   * Static configuration, not a callback — see `render.ts`. What a CONTAINER
   * shows for its items is a `preview`, which is a different thing entirely.
   */
  render(input: FieldRender): StringSchema<Src> {
    return new StringSchema<Src>(
      this.options,
      this.opt,
      this.isRaw,
      this.customValidateFunctions,
      input,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.previewInput,
      this.isMultiline,
    );
  }

  /**
   * How this VALUE is shown where a preview of it is needed — a row in a
   * sortable list, a reference dropdown, a search hit. Never how the field
   * itself is edited (that is `render`). See `preview.ts`.
   */
  preview(select: ItemPreviewInput<Src>): StringSchema<Src> {
    return new StringSchema<Src>(
      this.options,
      this.opt,
      this.isRaw,
      this.customValidateFunctions,
      this.renderInput,
      this.isReadonly,
      this.isHidden,
      this.description,
      select,
      this.isMultiline,
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

  /**
   * Nothing: a string has no items, so there is nothing to preview. Its layout
   * is a `render`, which travels in the serialized schema instead of through
   * this pipeline.
   */
  protected executePreview(): ReifiedPreview {
    return {};
  }
}

export const string = <T extends string>(
  options?: Record<string, never>,
): StringSchema<T> => {
  return new StringSchema(options);
};
