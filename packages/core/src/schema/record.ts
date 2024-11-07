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

export type SerializedRecordSchema = {
  type: "record";
  item: SerializedSchema;
  opt: boolean;
};

export class RecordSchema<
  T extends Schema<SelectorSource>,
  Src extends Record<string, SelectorOfSchema<T>> | null,
> extends Schema<Src> {
  constructor(
    readonly item: T,
    readonly opt: boolean = false,
  ) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationErrors {
    let error: ValidationErrors = false;

    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (src === null) {
      return {
        [path]: [{ message: `Expected 'object', got 'null'` }],
      } as ValidationErrors;
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
          src,
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

  assert(path: SourcePath, src: unknown): SchemaAssertResult<Src> {
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
    }
    if (typeof src !== "object") {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Expected 'object', got '${typeof src}'`,
              typeError: true,
            },
          ],
        },
      };
    }
    if (Array.isArray(src)) {
      return {
        success: false,
        errors: {
          [path]: [
            { message: `Expected 'object', got 'array'`, typeError: true },
          ],
        },
      };
    }
    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  nullable(): Schema<Src | null> {
    return new RecordSchema(this.item, true) as Schema<Src | null>;
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
  schema: S,
): Schema<Record<string, SelectorOfSchema<S>>> => {
  return new RecordSchema(schema) as Schema<
    Record<string, SelectorOfSchema<S>>
  >;
};
