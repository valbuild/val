import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ReifiedPreview } from "../preview";
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
  ) {
    super();
  }

  describe(description: string | null): NumberSchema<Src> {
    return new NumberSchema(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
    );
  }

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
      [],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
    );
  }

  readonly(): NumberSchema<Src> {
    return new NumberSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      true,
      this.isHidden,
      this.description,
      this.renderInput,
    );
  }

  hidden(): NumberSchema<Src> {
    return new NumberSchema<Src>(
      this.options,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      true,
      this.description,
      this.renderInput,
    );
  }

  max(max: number): NumberSchema<Src> {
    return new NumberSchema<Src>(
      { ...this.options, max },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
    );
  }

  min(min: number): NumberSchema<Src> {
    return new NumberSchema<Src>(
      { ...this.options, min },
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
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
    );
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "number",
      render: this.renderInput ?? undefined,
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
