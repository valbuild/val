/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaTypeOf, SerializedSchema } from ".";
import { initVal } from "../initVal";
import { SelectorSource } from "../selector";
import { createValPathOfItem } from "../selector/SelectorProxy";
import { SourcePath } from "../val";
import { string } from "./string";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedRecordSchema = {
  type: "record";
  item: SerializedSchema;
  opt: boolean;
};

export class RecordSchema<T extends Schema<SelectorSource>> extends Schema<
  Record<string, SchemaTypeOf<T>>
> {
  constructor(readonly item: T, readonly opt: boolean = false) {
    super();
  }

  validate(
    path: SourcePath,
    src: Record<string, SchemaTypeOf<T>>
  ): ValidationErrors {
    let error: ValidationErrors = false;

    if (this.opt && (src === null || src === undefined)) {
      return false;
    }

    if (typeof src !== "object") {
      return {
        [path]: [{ message: `Expected 'object', got '${typeof src}'` }],
      } as ValidationErrors;
    }
    if (Array.isArray(src)) {
      return {
        [path]: [{ message: `Expected 'object', got 'array'` }],
      } as ValidationErrors;
    }
    Object.entries(src).forEach(([key, elem]) => {
      const subPath = createValPathOfItem(path, key);
      if (!subPath) {
        error = this.appendValidationError(
          error,
          path,
          `Internal error: could not create path at ${
            !path && typeof path === "string" ? "<empty string>" : path
          } at key ${elem}`, // Should! never happen
          src
        );
      } else {
        const subError = this.item.validate(subPath, elem as SelectorSource);
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

  assert(src: Record<string, SchemaTypeOf<T>>): boolean {
    if (this.opt && (src === null || src === undefined)) {
      return true;
    }
    if (!src) {
      return false;
    }

    for (const [, item] of Object.entries(src)) {
      if (!this.item.assert(item)) {
        return false;
      }
    }
    return typeof src === "object" && !Array.isArray(src);
  }

  optional(): Schema<Record<string, SchemaTypeOf<T>> | null> {
    return new RecordSchema(this.item, true);
  }

  serialize(): SerializedRecordSchema {
    return {
      type: "record",
      item: this.item.serialize(),
      opt: this.opt,
    };
  }
}

export const record = <S extends Schema<SelectorSource>>(
  schema: S
): Schema<Record<string, SchemaTypeOf<S>>> => {
  return new RecordSchema(schema);
};
