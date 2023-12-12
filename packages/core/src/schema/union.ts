/* eslint-disable @typescript-eslint/no-unused-vars */
import { Schema, SerializedSchema } from ".";
import { createValPathOfItem } from "../selector/SelectorProxy";
import { SelectorSource } from "../selector/index";
import { SourceObject } from "../source";
import { SourcePath } from "../val";
import { LiteralSchema } from "./literal";
import { ObjectSchema, SerializedObjectSchema } from "./object";
import { ValidationErrors } from "./validation/ValidationError";

export type SerializedUnionSchema = {
  type: "union";
  key?: string;
  items: SerializedSchema[];
  opt: boolean;
};

type SourceOf<
  Key extends string | Schema<string>,
  T extends Schema<
    Key extends string
      ? SourceObject & { [k in Key]: string }
      : Key extends Schema<string>
      ? string
      : unknown
  >[]
> = T extends Schema<infer S>[]
  ? S extends SelectorSource
    ? S | (Key extends Schema<infer K> ? K : never)
    : never
  : never;

export class UnionSchema<
  Key extends string | Schema<string>,
  T extends Schema<
    Key extends string
      ? SourceObject & { [k in Key]: string }
      : Key extends Schema<string>
      ? string
      : unknown
  >[]
> extends Schema<SourceOf<Key, T>> {
  validate(path: SourcePath, src: SourceOf<Key, T>): ValidationErrors {
    const unknownSrc = src as unknown;
    const errors: ValidationErrors = false;

    if (this.opt && (unknownSrc === null || unknownSrc === undefined)) {
      // TODO: src should never be undefined
      return false;
    }

    if (!this.key) {
      return {
        [path]: [
          {
            message: `Missing required first argument in union`,
          },
        ],
      };
    }

    const key = this.key;
    if (!Array.isArray(this.items)) {
      return {
        [path]: [
          {
            message: `A union schema must take more than 1 schema arguments`,
            fatal: true,
          },
        ],
      };
    }
    if (typeof key === "string") {
      // tagged union
      if (this.items.some((item) => !(item instanceof ObjectSchema))) {
        return {
          [path]: [
            {
              message: `Key is a string, so all schema items must be objects`,
              fatal: true,
            },
          ],
        };
      }
      const objectSchemas = this.items as unknown as ObjectSchema<{
        [key: string]: Schema<SelectorSource>;
      }>[];
      const serializedSchemas = objectSchemas.map((schema) =>
        schema.serialize()
      );
      const illegalSchemas = serializedSchemas.filter(
        (schema) =>
          !(schema.type === "object") || !(schema.items[key].type === "literal")
      );

      if (illegalSchemas.length > 0) {
        return {
          [path]: [
            {
              message: `All schema items must be objects with a key: ${key} that is a literal schema. Found: ${JSON.stringify(
                illegalSchemas,
                null,
                2
              )}`,
              fatal: true,
            },
          ],
        };
      }
      const serializedObjectSchemas =
        serializedSchemas as SerializedObjectSchema[];
      const optionalLiterals = serializedObjectSchemas.filter(
        (schema) => schema.items[key].opt
      );
      if (optionalLiterals.length > 1) {
        return {
          [path]: [
            {
              message: `Schema cannot have an optional keys: ${key}`,
              fatal: true,
            },
          ],
        };
      }

      if (typeof unknownSrc !== "object") {
        return {
          [path]: [
            {
              message: `Expected an object`,
            },
          ],
        };
      }
      const objectSrc = unknownSrc as { [key: string]: SelectorSource };

      if (objectSrc[key] === undefined) {
        return {
          [path]: [
            {
              message: `Missing required key: ${key}`,
            },
          ],
        };
      }

      const foundSchemaLiterals: string[] = [];
      for (const schema of serializedObjectSchemas) {
        const schemaKey = schema.items[key];
        if (schemaKey.type === "literal") {
          if (!foundSchemaLiterals.includes(schemaKey.value)) {
            foundSchemaLiterals.push(schemaKey.value);
          } else {
            return {
              [path]: [
                {
                  message: `Found duplicate key in schema: ${schemaKey.value}`,
                  fatal: true,
                },
              ],
            };
          }
        }
      }
      const objectSchemaAtKey = objectSchemas.find(
        (schema) => !schema.items[key].validate(path, objectSrc[key])
      );
      if (!objectSchemaAtKey) {
        const keyPath = createValPathOfItem(path, key);
        if (!keyPath) {
          throw new Error(
            `Internal error: could not create path at ${
              !path && typeof path === "string" ? "<empty string>" : path
            } at key ${key}`
          );
        }
        return {
          [keyPath]: [
            {
              message: `Invalid key: "${key}". Value was: "${
                objectSrc[key]
              }". Valid values: ${serializedObjectSchemas
                .map((schema) => {
                  const keySchema = schema.items[key];
                  if (keySchema.type === "literal" && keySchema.value) {
                    return `"${keySchema.value}"`;
                  } else {
                    // should not happen here, we already checked this
                    throw new Error(
                      `Expected literal schema, got ${JSON.stringify(
                        keySchema,
                        null,
                        2
                      )}`
                    );
                  }
                })
                .join(", ")}`,
            },
          ],
        };
      }
      const error = objectSchemaAtKey.validate(path, objectSrc);
      if (error) {
        return error;
      }
    } else if (key instanceof LiteralSchema) {
      if (this.items.some((item) => !(item instanceof LiteralSchema))) {
        return {
          [path]: [
            {
              message: `Key is a literal schema, so all schema items must be literals`,
              fatal: true,
            },
          ],
        };
      }
      const literalItems = [key, ...this.items] as LiteralSchema<string>[];
      if (typeof unknownSrc === "string") {
        const isMatch = literalItems.some(
          (item) => !item.validate(path, unknownSrc)
        );
        if (!isMatch) {
          return {
            [path]: [
              {
                message: `Union must match one of the following: ${literalItems
                  .map((item) => `"${item.value}"`)
                  .join(", ")}`,
              },
            ],
          };
        }
      }
    } else {
      return {
        [path]: [
          {
            message: `Expected a string or literal`,
          },
        ],
      };
    }
    return errors;
  }
  assert(src: SourceOf<Key, T>): boolean {
    return true;
  }
  optional(): Schema<SourceOf<Key, T> | null> {
    return new UnionSchema(this.key, this.items, true);
  }
  serialize(): SerializedSchema {
    if (typeof this.key === "string") {
      return {
        type: "union",
        key: this.key,
        items: this.items.map((o) => o.serialize()),
        opt: this.opt,
      };
    }
    return {
      type: "union",
      items: this.items.map((o) => o.serialize()),
      opt: this.opt,
    };
  }

  constructor(
    readonly key: Key,
    readonly items: T,
    readonly opt: boolean = false
  ) {
    super();
  }
}

export const union = <
  Key extends string | Schema<string>,
  T extends Schema<
    Key extends string
      ? SourceObject & { [k in Key]: string }
      : Key extends Schema<string>
      ? string
      : unknown
  >[]
>(
  key: Key,
  ...objects: T
): Schema<SourceOf<Key, T>> => {
  return new UnionSchema(key, objects);
};
