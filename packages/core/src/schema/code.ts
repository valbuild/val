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
   *   .code({ language: "css" })
   *   .describe("Injected into the page head — keep it small");
   * export default c.define(
   *   "/example.val.ts",
   *   schema,
   *   ".hero { color: red; }",
   * );
   */
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
   * const schema = s.code({ language: "json" }).validate((val) => {
   *   try {
   *     JSON.parse(val);
   *     return false;
   *   } catch {
   *     return "Must be valid JSON";
   *   }
   * });
   * export default c.define("/example.val.ts", schema, '{ "a": 1 }');
   */
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
   *
   * @example
   * const schema = s.array(
   *   s.code({ language: "css" }).render({ as: "inline" }),
   * );
   * export default c.define("/example.val.ts", schema, [
   *   ".hero { color: red; }",
   * ]);
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
   *
   * @example
   * const schema = s.array(
   *   s.code({ language: "css" }).preview(({ val }) => ({
   *     title: val.split("\n")[0],
   *   })),
   * );
   * export default c.define("/example.val.ts", schema, [
   *   ".hero { color: red; }",
   * ]);
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
