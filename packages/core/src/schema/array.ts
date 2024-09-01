/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Schema,
  SchemaAssertResult,
  SelectorOfSchema,
  SerializedSchema,
} from ".";
import { SelectorSource } from "../selector";
import { createValPathOfItem } from "../selector/SelectorProxy";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedArraySchema = {
  type: "array";
  item: SerializedSchema;
  opt: boolean;
};

export class ArraySchema<
  T extends Schema<SelectorSource>,
  Src extends SelectorOfSchema<T>[] | null
> extends Schema<Src> {
  constructor(readonly item: T, readonly opt: boolean = false) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationErrors {
    let error: ValidationErrors = false;

    if (this.opt && src === null) {
      return false;
    }
    if (src === null) {
      return {
        [path]: [{ message: `Expected 'array', got 'null'` }],
      } as ValidationErrors;
    }

    if (typeof src !== "object" || !Array.isArray(src)) {
      return {
        [path]: [{ message: `Expected 'array', got '${typeof src}'` }],
      } as ValidationErrors;
    }
    src.forEach((i, idx) => {
      const subPath = createValPathOfItem(path, idx);
      if (!subPath) {
        error = this.appendValidationError(
          error,
          path,
          `Internal error: could not create path at ${
            !path && typeof path === "string" ? "<empty string>" : path
          } at index ${idx}`, // Should! never happen
          src
        );
      } else {
        const subError = this.item.validate(subPath, i);
        if (subError && error) {
          error = {
            ...subError,
            ...error,
          };
        } else if (subError) {
          error = subError;
        }
      }
    });

    return error;
  }

  assert(
    path: SourcePath,
    src: unknown
  ): SchemaAssertResult<Src, SelectorSource[]> {
    if (src === null && this.opt) {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src, SelectorSource[]>;
    }
    if (src === null) {
      return {
        success: false,
        errors: {
          [path]: [{ message: "Expected 'array', got 'null'" }],
        },
      };
    }
    if (typeof src !== "object") {
      return {
        success: false,
        errors: {
          [path]: [{ message: `Expected 'object', got '${typeof src}'` }],
        },
      };
    } else if (!Array.isArray(src)) {
      return {
        success: false,
        errors: {
          [path]: [{ message: `Expected object of type 'array'` }],
        },
      };
    }
    return {
      success: true,
      data: src,
    };
  }

  nullable(): Schema<Src | null> {
    return new ArraySchema(this.item, true);
  }

  serialize(): SerializedArraySchema {
    return {
      type: "array",
      item: this.item.serialize(),
      opt: this.opt,
    };
  }
}

export const array = <S extends Schema<SelectorSource>>(
  schema: S
): Schema<SelectorOfSchema<S>[]> => {
  return new ArraySchema(schema);
};
