/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaAssertResult, SerializedSchema } from ".";
import { ReifiedPreview } from "../preview";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedLiteralSchema = {
  type: "literal";
  value: string;
  opt: boolean;
};

export class LiteralSchema<Src extends string | null> extends Schema<Src> {
  constructor(
    private readonly value: string,
    private readonly opt: boolean = false,
  ) {
    super();
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
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

  nullable(): Schema<Src | null> {
    return new LiteralSchema<Src | null>(this.value, true);
  }

  protected executeSerialize(): SerializedSchema {
    return {
      type: "literal",
      value: this.value,
      opt: this.opt,
    };
  }

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

export const literal = <T extends string>(value: T): LiteralSchema<T> => {
  return new LiteralSchema(value);
};
