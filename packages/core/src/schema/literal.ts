/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedLiteralSchema = {
  type: "literal";
  value: string;
  opt: boolean;
};

export class LiteralSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    readonly value: string,
    readonly opt: boolean = false,
  ) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationErrors {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (typeof src !== "string") {
      return {
        [path]: [
          { message: `Expected 'string', got '${typeof src}'`, value: src },
        ],
      } as ValidationErrors;
    }
    if (src !== this.value) {
      return {
        [path]: [
          {
            message: `Expected literal '${this.value}', got '${src}'`,
            value: src,
          },
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
    if (typeof src === "string" && src === this.value) {
      return {
        success: true,
        data: src,
      };
    }
    return {
      success: false,
      errors: {
        [path]: [
          {
            message: `Expected literal '${this.value}', got '${src}'`,
            value: src,
          },
        ],
      },
    };
  }

  nullable(): Schema<Src | null> {
    return new LiteralSchema<Src | null>(this.value, true);
  }

  serialize(): SerializedSchema {
    return {
      type: "literal",
      value: this.value,
      opt: this.opt,
    };
  }
}

export const literal = <T extends string>(value: T): LiteralSchema<T> => {
  return new LiteralSchema(value);
};
