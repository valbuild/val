/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import { ReifiedRender } from "../render";
import { ModuleFilePath, SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedBooleanSchema = {
  type: "boolean";
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

export class BooleanSchema<Src extends boolean | null> extends Schema<Src> {
  constructor(
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
  ) {
    super();
  }

  describe(description: string | null): BooleanSchema<Src> {
    return new BooleanSchema(
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
    );
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): BooleanSchema<Src> {
    return new BooleanSchema(
      this.opt,
      [...this.customValidateFunctions, validationFunction],
      this.isReadonly,
      this.isHidden,
      this.description,
    );
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

  nullable(): BooleanSchema<Src | null> {
    return new BooleanSchema<Src | null>(
      true,
      [],
      this.isReadonly,
      this.isHidden,
      this.description,
    );
  }

  readonly(): BooleanSchema<Src> {
    return new BooleanSchema<Src>(
      this.opt,
      this.customValidateFunctions,
      true,
      this.isHidden,
      this.description,
    );
  }

  hidden(): BooleanSchema<Src> {
    return new BooleanSchema<Src>(
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      true,
      this.description,
    );
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "boolean",
      opt: this.opt,
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

export const boolean = (): BooleanSchema<boolean> => {
  return new BooleanSchema();
};
