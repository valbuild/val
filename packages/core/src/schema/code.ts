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

/**
 * The list is the declaration and {@link CodeLanguage} is derived from it, so
 * that a validator elsewhere (`shared`'s zod schema) can enumerate the same
 * languages without a second copy that drifts. Same shape as `COLOR_FORMATS`.
 */
export const CODE_LANGUAGES = [
  "typescript",
  "javascript",
  "javascriptreact",
  "typescriptreact",
  "json",
  "java",
  "html",
  "css",
  "xml",
  "markdown",
  "sql",
  "python",
  "rust",
  "php",
  "go",
  "cpp",
  "sass",
  "vue",
  "angular",
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

export type CodeOptions = {
  /**
   * The language to syntax highlight the editor with.
   *
   * Omit it for a plain monospaced editor with no highlighting.
   *
   * @example
   * "typescript"
   * "json"
   * "markdown"
   */
  language?: CodeLanguage;
};

export type SerializedCodeSchema = {
  type: "code";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  options?: CodeOptions;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

/**
 * A string edited in a code editor.
 *
 * Its own schema type rather than a layout on `s.string()`: the language is
 * part of what the content IS, not of how one field happens to be drawn, and
 * being a type is what lets the value stay out of stega encoding — invisible
 * characters woven into source code are not something a consumer can render.
 */
export class CodeSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly options?: CodeOptions,
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

  describe(description: string | null): CodeSchema<Src> {
    return new CodeSchema(
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

  validate(validationFunction: (src: Src) => false | string): CodeSchema<Src> {
    return new CodeSchema(
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
        message: `Expected 'string', got '${src === null ? "null" : typeof src}'`,
        value: src,
      });
    }
    if (errors.length > 0) {
      return { [path]: errors };
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
    if (typeof src !== "string") {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Expected 'string', got '${src === null ? "null" : typeof src}'`,
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

  nullable(): CodeSchema<Src | null> {
    return new CodeSchema<Src | null>(
      this.options,
      true,
      [],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  readonly(isReadonly: boolean = true): CodeSchema<Src> {
    return new CodeSchema<Src>(
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

  hidden(isHidden: boolean = true): CodeSchema<Src> {
    return new CodeSchema<Src>(
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
   * How this field is laid out in the editor when it is the item of an array
   * or record: `{ as: "inline" }` renders the field itself inside each row,
   * instead of a preview row that navigates to it.
   *
   * Static configuration, not a callback — see `render.ts`.
   */
  render(input: FieldRender): CodeSchema<Src> {
    return new CodeSchema<Src>(
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
   */
  preview(select: ItemPreviewInput<Src>): CodeSchema<Src> {
    return new CodeSchema<Src>(
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
      type: "code",
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

export const code = (options?: CodeOptions): CodeSchema<RawString> => {
  return new CodeSchema(options);
};
