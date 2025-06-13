/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ReifiedPreview } from "../preview";
import { ModuleFilePath, SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedBooleanSchema = {
  type: "boolean";
  opt: boolean;
  customValidate?: boolean;
};

export class BooleanSchema<Src extends boolean | null> extends Schema<Src> {
  constructor(
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
  ) {
    super();
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): BooleanSchema<Src> {
    return new BooleanSchema(this.opt, [
      ...this.customValidateFunctions,
      validationFunction,
    ]);
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (typeof src !== "boolean") {
      return {
        [path]: [
          { message: `Expected 'boolean', got '${typeof src}'`, value: src },
        ],
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
    if (src === null) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: "Expected 'boolean', got 'null'",
              typeError: true,
            },
          ],
        },
      };
    }
    if (typeof src !== "boolean") {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Expected 'boolean', got '${typeof src}'`,
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

  nullable(): Schema<Src | null> {
    return new BooleanSchema<Src | null>(true);
  }
  protected executeSerialize(): SerializedSchema {
    return {
      type: "boolean",
      opt: this.opt,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
    };
  }

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

export const boolean = (): BooleanSchema<boolean> => {
  return new BooleanSchema();
};
