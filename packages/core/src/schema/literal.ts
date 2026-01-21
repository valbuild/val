 
import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ReifiedRender } from "../render";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedLiteralSchema = {
  type: "literal";
  value: string;
  opt: boolean;
  customValidate?: boolean;
};

export class LiteralSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly value: string,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
  ) {
    super();
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): LiteralSchema<Src> {
    return new LiteralSchema(this.value, this.opt, [
      ...this.customValidateFunctions,
      validationFunction,
    ]);
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
    return new LiteralSchema<Src | null>(this.value, true);
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "literal",
      value: this.value,
      opt: this.opt,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
    };
  }

  protected executeRender(): ReifiedRender {
    return {};
  }
}

export const literal = <T extends string>(value: T): LiteralSchema<T> => {
  return new LiteralSchema(value);
};
