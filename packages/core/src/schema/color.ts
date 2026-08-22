import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ReifiedRender } from "../render";
import { SourcePath } from "../val";
import {
  ColorFormat,
  DEFAULT_COLOR_FORMAT,
  detectColorFormat,
  formatColor,
  parseColor,
} from "./colorFormat";
import { RawString } from "./string";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type { ColorFormat } from "./colorFormat";

export type ColorOptions = {
  /**
   * The CSS notation the color is stored in.
   *
   * Defaults to `"hsl"`.
   *
   * @example
   * "hex"   // #3b82f6
   * "rgb"   // rgb(59 130 246)
   * "hsl"   // hsl(217.22 91.22% 59.8%)
   * "oklch" // oklch(0.6231 0.188 259.81)
   */
  format?: ColorFormat;
  /**
   * Allow an alpha channel (transparency).
   *
   * Defaults to `false`: a color with an alpha channel is a validation error
   * unless this is enabled.
   */
  alpha?: boolean;
};

export type SerializedColorSchema = {
  type: "color";
  options?: ColorOptions;
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

/**
 * An example of the canonical output of each format, used in error messages so
 * that the expected syntax is obvious from the error alone.
 */
const FORMAT_EXAMPLES: Record<ColorFormat, string> = {
  hex: "#3b82f6",
  rgb: "rgb(59 130 246)",
  hsl: "hsl(217.22 91.22% 59.8%)",
  oklch: "oklch(0.6231 0.188 259.81)",
};

export class ColorSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly options?: ColorOptions,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
  ) {
    super();
  }

  describe(description: string | null): ColorSchema<Src> {
    return new ColorSchema(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
    );
  }

  validate(validationFunction: (src: Src) => false | string): ColorSchema<Src> {
    return new ColorSchema(
      this.options,
      this.opt,
      [...this.customValidateFunctions, validationFunction],
      this.isReadonly,
      this.isHidden,
      this.description,
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
        message: `Expected 'string', got '${typeof src}'`,
        value: src,
      });
      return { [path]: errors } as ValidationErrors;
    }
    const expectedFormat = this.options?.format ?? DEFAULT_COLOR_FORMAT;
    const parsed = parseColor(src);
    if (parsed === null) {
      errors.push({
        message: `Invalid color: '${src}'. Expected a CSS color in the '${expectedFormat}' format (e.g. '${FORMAT_EXAMPLES[expectedFormat]}')`,
        value: src,
      });
    } else {
      const actualFormat = detectColorFormat(src);
      if (actualFormat !== expectedFormat) {
        // Drop alpha from the SUGGESTION when alpha is not enabled, the same way
        // the field's commit does. Keeping it would suggest a value that fails
        // the alpha check immediately below, so following the advice would not
        // clear the error.
        const suggestion = formatColor(
          this.options?.alpha ? parsed : { ...parsed, a: 1 },
          expectedFormat,
        );
        errors.push({
          message: `Expected a color in the '${expectedFormat}' format (e.g. '${FORMAT_EXAMPLES[expectedFormat]}'), got '${src}'. Did you mean '${suggestion}'?`,
          value: src,
        });
      }
      if (!this.options?.alpha && parsed.a < 1) {
        errors.push({
          message: `Color '${src}' has an alpha channel, but alpha is not enabled. Use s.color({ alpha: true }) to allow transparency`,
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

  nullable(): ColorSchema<Src | null> {
    return new ColorSchema<Src | null>(
      this.options,
      true,
      [],
      this.isReadonly,
      this.isHidden,
      this.description,
    );
  }

  readonly(): ColorSchema<Src> {
    return new ColorSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      true,
      this.isHidden,
      this.description,
    );
  }

  hidden(): ColorSchema<Src> {
    return new ColorSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      true,
      this.description,
    );
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "color",
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

  protected executeRender(): ReifiedRender {
    return {};
  }
}

export const color = (options?: ColorOptions): ColorSchema<RawString> => {
  return new ColorSchema(options);
};
