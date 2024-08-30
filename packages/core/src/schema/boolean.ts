/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedBooleanSchema = {
  type: "boolean";
  opt: boolean;
};

export class BooleanSchema<Src extends boolean | null> extends Schema<Src> {
  constructor(readonly opt: boolean = false) {
    super();
  }
  validate(path: SourcePath, src: Src): ValidationErrors {
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

  assert(path: SourcePath, src: Src): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      };
    }
    if (src === null) {
      return {
        success: false,
        errors: {
          [path]: [{ message: "Expected 'boolean', got 'null'", value: src }],
        },
      };
    }
    if (typeof src !== "boolean") {
      return {
        success: false,
        errors: {
          [path]: [
            { message: `Expected 'boolean', got '${typeof src}'`, value: src },
          ],
        },
      };
    }
    return {
      success: true,
      data: src,
    };
  }

  nullable(): Schema<Src | null> {
    return new BooleanSchema<Src | null>(true);
  }
  serialize(): SerializedSchema {
    return {
      type: "boolean",
      opt: this.opt,
    };
  }
}

export const boolean = (): Schema<boolean> => {
  return new BooleanSchema();
};
