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

export type SerializedObjectSchema = {
  type: "object";
  items: Record<string, SerializedSchema>;
  opt: boolean;
};

type ObjectSchemaProps = { [key: string]: Schema<SelectorSource> } & {
  /** Cannot create object with key: valPath. It is a reserved name */
  valPath?: never;
  /** Cannot create object with key: val. It is a reserved name */
  val?: never;
  /** Cannot create object with key: _type. It is a reserved name */
  _type?: never;
  /** Cannot create object with key: _ref. It is a reserved name */
  _ref?: never;
  // The ones below we might want to allow (they are no longer intended to be used):
  /** Cannot create object with key: andThen. It is a reserved name */
  andThen?: never;
  /** Cannot create object with key: assert. It is a reserved name */
  assert?: never;
  /** Cannot create object with key: fold. It is a reserved name */
  fold?: never;
};
type ObjectSchemaSrcOf<Props extends ObjectSchemaProps> = {
  [key in keyof Props]: SelectorOfSchema<Props[key]>;
};

export class ObjectSchema<
  Props extends ObjectSchemaProps,
  Src extends ObjectSchemaSrcOf<Props> | null,
> extends Schema<Src> {
  constructor(
    readonly items: Props,
    readonly opt: boolean = false,
  ) {
    super();
  }

  validate(path: SourcePath, src: Src): ValidationErrors {
    let error: ValidationErrors = false;

    // TODO: src should never be undefined
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
    } else if (Array.isArray(src)) {
      return {
        [path]: [{ message: `Expected 'object', got 'array'` }],
      } as ValidationErrors;
    }

    Object.entries(this.items).forEach(([key, schema]) => {
      const subPath = createValPathOfItem(path, key);
      if (!subPath) {
        error = this.appendValidationError(
          error,
          path,
          `Internal error: could not create path at ${
            !path && typeof path === "string" ? "<empty string>" : path
          } at key ${key}`, // Should! never happen
          src,
        );
      } else {
        const subError = schema.validate(subPath, src[key]);
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

  assert(path: SourcePath, src: unknown) {
    throw new Error("Method not implemented.");
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      };
    }

    if (typeof src !== "object") {
      return {
        success: false,
        errors: {
          [path]: [{ message: `Expected 'object', got '${typeof src}'` }],
        },
      };
    } else if (Array.isArray(src)) {
      return {
        success: false,
        errors: {
          [path]: [{ message: `Expected 'object', got 'array'` }],
        },
      };
    }

    let error: ValidationErrors = false;
    for (const key of Object.keys(this.items)) {
      const subPath = createValPathOfItem(path, key);
      if (!subPath) {
        error = this.appendValidationError(
          error,
          path,
          `Internal error: could not create path at ${
            !path && typeof path === "string" ? "<empty string>" : path
          } at key ${key}`, // Should! never happen
          src,
        );
      } else if (!src?.[key]) {
        error = this.appendValidationError(
          error,
          subPath,
          `Expected key '${key}' not found in object`,
          src,
        );
      }
    }
    if (error) {
      return {
        success: false,
        errors: error,
      };
    }
    return {
      success: true,
      data: src,
    };
  }

  nullable(): Schema<Src | null> {
    return new ObjectSchema(this.items, true) as Schema<Src | null>;
  }

  serialize(): SerializedSchema {
    return {
      type: "object",
      items: Object.fromEntries(
        Object.entries(this.items).map(([key, schema]) => [
          key,
          schema.serialize(),
        ]),
      ),
      opt: this.opt,
    };
  }
}

export const object = <Props extends ObjectSchemaProps>(
  schema: Props,
): Schema<{
  [key in keyof Props]: SelectorOfSchema<Props[key]>;
}> => {
  return new ObjectSchema(schema);
};
