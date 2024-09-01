/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaAssertResult, SerializedSchema } from ".";
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

  assert(path: SourcePath, src: unknown) {
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      };
    }
    if (typeof src === "number") {
      return {
        success: true,
        data: src,
      };
    }
    return {
      success: false,
      errors: {
        [path]: [
          { message: `Expected 'number', got '${typeof src}'`, value: src },
        ],
      },
    };
  }

  nullable(): Schema<number | null> {
    return new NumberSchema<Src | null>(this.options, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "number",
      options: this.options,
      opt: this.opt,
    };
  }
}

export const number = (options?: NumberOptions): Schema<number> => {
  return new NumberSchema(options);
};
