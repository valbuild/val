/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { ReifiedPreview } from "../preview";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

type NumberOptions = {
  max?: number;
  min?: number;
};

export type SerializedNumberSchema = {
  type: "number";
  options?: NumberOptions;
  opt: boolean;
};

export class NumberSchema<Src extends number | null> extends Schema<Src> {
  constructor(
    private readonly options?: NumberOptions,
    private readonly opt: boolean = false,
  ) {
    super();
  }
  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (typeof src !== "number") {
      return {
        [path]: [
          { message: `Expected 'number', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }
    if (this.options?.max && src > this.options.max) {
      return {
        [path]: [
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
          {
            message: `Expected 'number' greater than ${this.options.min}`,
            value: src,
          },
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

  nullable(): Schema<Src> {
    return new NumberSchema<Src | null>(this.options, true) as Schema<Src>;
  }

  max(max: number): NumberSchema<Src> {
    return new NumberSchema<Src>({ ...this.options, max }, this.opt);
  }

  min(min: number): NumberSchema<Src> {
    return new NumberSchema<Src>({ ...this.options, min }, this.opt);
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "number",
      options: this.options,
      opt: this.opt,
    };
  }

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

export const number = (options?: NumberOptions): NumberSchema<number> => {
  return new NumberSchema(options) as NumberSchema<number>;
};
