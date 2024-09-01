/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaAssertResult, SerializedSchema } from "../schema";
import { ValModuleBrand } from "../module";
import { GenericSelector, GetSchema, Path } from "../selector";
import { Source, SourceArray, SourceObject } from "../source";
import { SourcePath, getValPath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";
import { RawString } from "./string";

export type SerializedKeyOfSchema = {
  type: "keyOf";
  path: SourcePath;
  schema: SerializedSchema;
  opt: boolean;
  values: "string" | "number" | string[];
};

type KeyOfSelector<Sel extends GenericSelector<SourceArray | SourceObject>> =
  Sel extends GenericSelector<infer S>
    ? S extends readonly Source[]
      ? number
      : S extends SourceObject
        ? string extends keyof S
          ? RawString
          : keyof S
        : S extends Record<string, Source> // do we need record?
          ? RawString
          : never
    : never;

export class KeyOfSchema<
  Sel extends GenericSelector<SourceArray | SourceObject>,
> extends Schema<KeyOfSelector<Sel>> {
  constructor(
    readonly schema?: SerializedSchema,
    readonly sourcePath?: SourcePath,
    readonly opt: boolean = false,
  ) {
    super();
  }
  validate(path: SourcePath, src: KeyOfSelector<Sel>): ValidationErrors {
    if (this.opt && (src === null || src === undefined)) {
      return false;
    }
    if (!this.schema) {
      return {
        [path]: [
          {
            message: `Schema not found for module. keyOf must be used with a Val Module`,
          },
        ],
      };
    }
    const serializedSchema = this.schema;

    if (
      !(
        serializedSchema.type === "array" ||
        serializedSchema.type === "object" ||
        serializedSchema.type === "record"
      )
    ) {
      return {
        [path]: [
          {
            message: `Schema in keyOf must be an 'array', 'object' or 'record'. Found '${serializedSchema.type}'`,
          },
        ],
      };
    }
    if (serializedSchema.opt && (src === null || src === undefined)) {
      return false;
    }
    if (serializedSchema.type === "array" && typeof src !== "number") {
      return {
        [path]: [
          {
            message: "Type of value in keyof (array) must be 'number'",
          },
        ],
      };
    }
    if (serializedSchema.type === "record" && typeof src !== "string") {
      return {
        [path]: [
          {
            message: "Type of value in keyof (record) must be 'string'",
          },
        ],
      };
    }
    if (serializedSchema.type === "object") {
      const keys = Object.keys(serializedSchema.items);
      if (!keys.includes(src as string)) {
        return {
          [path]: [
            {
              message: `Value of keyOf (object) must be: ${keys.join(
                ", ",
              )}. Found: ${src}`,
            },
          ],
        };
      }
    }
    return false;
  }

  assert(
    path: SourcePath,
    src: KeyOfSelector<Sel>
  ): SchemaAssertResult<KeyOfSelector<Sel>> {
    if (this.opt && src === null) {
      return {
        success: true,
        data: src,
      };
    }
    const schema = this.schema;
    if (!schema) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Neither key nor schema was found. keyOf is missing an argument.`,
            },
          ],
        },
      };
    }
    const serializedSchema = schema;

    if (
      !(
        serializedSchema.type === "array" ||
        serializedSchema.type === "object" ||
        serializedSchema.type === "record"
      )
    ) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Schema of first argument must be either: 'array', 'object' or 'record'. Found '${serializedSchema.type}'`,
            },
          ],
        },
      };
    }
    if (serializedSchema.type === "array" && typeof src !== "number") {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Value of keyOf (array) must be 'number', got '${typeof src}'`,
              value: src,
            },
          ],
        },
      };
    }
    if (serializedSchema.type === "record" && typeof src !== "string") {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Value of keyOf (record) must be 'string', got '${typeof src}'`,
              value: src,
            },
          ],
        },
      };
    }
    if (serializedSchema.type === "object") {
      const keys = Object.keys(serializedSchema.items);
      if (!keys.includes(src as string)) {
        return {
          success: false,
          errors: {
            [path]: [
              {
                message: `Value of keyOf (object) must be: ${keys.join(
                  ", "
                )}. Found: ${src}`,
                value: src,
              },
            ],
          },
        };
      }
    }
    return {
      success: true,
      data: src,
    };
  }

  nullable(): Schema<KeyOfSelector<Sel> | null> {
    return new KeyOfSchema(this.schema, this.sourcePath, true);
  }

  serialize(): SerializedSchema {
    const path = this.sourcePath;
    if (!path) {
      throw new Error(
        "Cannot serialize keyOf schema with empty selector. TIP: keyOf must be used with a Val Module.",
      );
    }
    const serializedSchema = this.schema;
    if (!serializedSchema) {
      throw new Error("Cannot serialize keyOf schema with empty selector.");
    }

    let values: SerializedKeyOfSchema["values"];
    switch (serializedSchema.type) {
      case "array":
        values = "number";
        break;
      case "record":
        values = "string";
        break;
      case "object":
        values = Object.keys(serializedSchema.items);
        break;
      default:
        throw new Error(
          `Cannot serialize keyOf schema with selector of type '${serializedSchema.type}'. keyOf must be used with a Val Module.`,
        );
    }
    return {
      type: "keyOf",
      path: path,
      schema: serializedSchema,
      opt: this.opt,
      values,
    } satisfies SerializedKeyOfSchema;
  }
}

export const keyOf = <
  Src extends GenericSelector<SourceArray | SourceObject> & ValModuleBrand, // ValModuleBrand enforces call site to pass in a val module - selectors are not allowed. The reason is that this should make it easier to patch. We might be able to relax this constraint in the future
>(
  valModule: Src,
): Schema<KeyOfSelector<Src>> => {
  return new KeyOfSchema(
    valModule?.[GetSchema]?.serialize(),
    getValPath(valModule),
  );
};
