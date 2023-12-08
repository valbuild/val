/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SelectorOfSchema, SerializedSchema } from ".";
import { SelectorSource } from "../selector";
import { createValPathOfItem } from "../selector/SelectorProxy";
import { SourcePath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedArraySchema = {
  type: "array";
  item: SerializedSchema;
  opt: boolean;
};

export class ArraySchema<T extends Schema<SelectorSource>> extends Schema<
  SelectorOfSchema<T>[]
> {
  constructor(readonly item: T, readonly opt: boolean = false) {
    super();
  }

  validate(path: SourcePath, src: SelectorOfSchema<T>[]): ValidationErrors {
    let error: ValidationErrors = false;

    if (this.opt && (src === null || src === undefined)) {
      return false;
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

  assert(src: SelectorOfSchema<T>[]): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    if (!src) {
      return false;
    }

    for (const item of src) {
      if (!this.item.assert(item)) {
        return false;
      }
    }
    return typeof src === "object" && Array.isArray(src);
  }

  optional(): Schema<SelectorOfSchema<T>[] | null> {
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
