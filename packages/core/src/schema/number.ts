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
    readonly options?: NumberOptions,
    readonly opt: boolean = false,
  ) {
    super();
  }
  validate(path: SourcePath, src: Src): ValidationErrors {
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
    return false;
  }

  assert(path: SourcePath, src: unknown): SchemaAssertResult<Src> {
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

  serialize(): SerializedSchema {
    return {
      type: "number",
      options: this.options,
      opt: this.opt,
    };
  }

  protected executePreview(src: Src): ReifiedPreview {
    return {
      status: "success",
      data: {
        renderType: "auto",
        schemaType: "scalar",
      },
    };
  }
}

export const number = (options?: NumberOptions): Schema<number> => {
  return new NumberSchema(options) as Schema<number>;
};
