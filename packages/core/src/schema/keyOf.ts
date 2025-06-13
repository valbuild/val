/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SchemaAssertResult, SerializedSchema } from "../schema";
import { ValModuleBrand } from "../module";
import { GenericSelector, GetSchema } from "../selector";
import { Source, SourceObject } from "../source";
import { SourcePath, getValPath } from "../val";
import { ValidationErrors } from "./validation/ValidationError";
import { RawString } from "./string";
import { ReifiedPreview } from "../preview";

export type SerializedKeyOfSchema = {
  type: "keyOf";
  path: SourcePath;
  schema: SerializedSchema;
  opt: boolean;
  values: "string" | string[];
};

type KeyOfSelector<Sel extends GenericSelector<SourceObject>> =
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
  Sel extends GenericSelector<SourceObject>,
  Src extends KeyOfSelector<Sel> | null,
> extends Schema<Src> {
  constructor(
    readonly schema?: SerializedSchema,
    readonly sourcePath?: SourcePath,
    readonly opt: boolean = false,
  ) {
    super();
  }
  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
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
        serializedSchema.type === "object" || serializedSchema.type === "record"
      )
    ) {
      return {
        [path]: [
          {
            message: `Schema in keyOf must be an 'object' or 'record'. Found '${serializedSchema.type}'`,
          },
        ],
      };
    }
    if (serializedSchema.opt && (src === null || src === undefined)) {
      return false;
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
    if (serializedSchema.type === "record") {
      if (typeof src !== "string") {
        return {
          [path]: [
            {
              message: `Value of keyOf (record) must be 'string'. Found: ${typeof src}`,
            },
          ],
        };
      }
      return {
        [path]: [
          {
            fixes: ["keyof:check-keys"],
            message: `Did not validate keyOf (record). This error (keyof:check-keys) should typically be processed by Val internally. Seeing this error most likely means you have a Val version mismatch.`,
            value: {
              key: src,
              sourcePath: this.sourcePath,
            },
          },
        ],
      };
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
    const schema = this.schema;
    if (!schema) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Neither key nor schema was found. keyOf is missing an argument.`,
              typeError: true,
            },
          ],
        },
      };
    }
    const serializedSchema = schema;

    if (
      !(
        serializedSchema.type === "object" || serializedSchema.type === "record"
      )
    ) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Schema of first argument must be either: 'array', 'object' or 'record'. Found '${serializedSchema.type}'`,
              typeError: true,
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
              typeError: true,
            },
          ],
        },
      };
    }
    // We check actual value here, since TypeScript also does this. Literals are used in other types (unions),
    // and there it also makes sense to check the actual string values (i.e. that it is not just a string) since
    // missing one would lead to a runtime error. At least this is what we are thinking currently.
    if (serializedSchema.type === "object") {
      const keys = Object.keys(serializedSchema.items);
      if (!keys.includes(src as string)) {
        return {
          success: false,
          errors: {
            [path]: [
              {
                message: `Value of keyOf (object) must be: ${keys.join(
                  ", ",
                )}. Found: ${src}`,
                typeError: true,
              },
            ],
          },
        };
      }
    }
    return {
      success: true,
      data: src,
    } as SchemaAssertResult<Src>;
  }

  nullable(): Schema<Src | null> {
    return new KeyOfSchema(
      this.schema,
      this.sourcePath,
      true,
    ) as Schema<Src | null>;
  }

  protected executeSerialize(): SerializedSchema {
    const path = this.sourcePath;
    if (!path) {
      throw new Error(
        "Cannot serialize keyOf schema with empty selector. TIP: keyOf must be used with a Val Module of record schema.",
      );
    }
    const serializedSchema = this.schema;
    if (!serializedSchema) {
      throw new Error("Cannot serialize keyOf schema with empty selector.");
    }

    let values: SerializedKeyOfSchema["values"];
    switch (serializedSchema.type) {
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

  protected executePreview(): ReifiedPreview {
    return {};
  }
}

export const keyOf = <
  Src extends GenericSelector<SourceObject> & ValModuleBrand, // ValModuleBrand enforces call site to pass in a val module - selectors are not allowed. The reason is that this should make it easier to patch. We might be able to relax this constraint in the future
>(
  valModule: Src,
): Schema<KeyOfSelector<Src>> => {
  return new KeyOfSchema(
    valModule?.[GetSchema]?.["executeSerialize"](),
    getValPath(valModule),
  ) as Schema<KeyOfSelector<Src>>;
};
