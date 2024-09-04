/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Schema,
  SchemaAssertResult,
  SelectorOfSchema,
  SerializedSchema,
} from ".";
import { SelectorSource } from "../selector";
import {
  createValPathOfItem,
  unsafeCreateSourcePath,
} from "../selector/SelectorProxy";
import { SourcePath } from "../val";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

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
    const assertRes = this.assert(path, src);
    if (!assertRes.success) {
      return assertRes.errors;
    }
    if (assertRes.data === null) {
      return false;
    }
    let error: Record<SourcePath, ValidationError[]> = {};
    for (const [idx, i] of Object.entries(assertRes.data)) {
      const subPath = unsafeCreateSourcePath(path, Number(idx));
      const subError = this.item.validate(subPath, i);
      if (subError) {
        error = {
          ...subError,
          ...error,
        };
      }
    }

    if (Object.keys(error).length === 0) {
      return false;
    }
    return error;
  }

  assert(path: SourcePath, src: unknown): SchemaAssertResult<Src> {
    if (src === null && this.opt) {
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
            { message: "Expected 'array', got 'null'", typeError: true },
          ],
        },
      };
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
    } else if (!Array.isArray(src)) {
      return {
        success: false,
        errors: {
          [path]: [
            { message: `Expected object of type 'array'`, typeError: true },
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
