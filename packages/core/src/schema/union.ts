/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  AssertError,
  CustomValidateFunction,
  Schema,
  SchemaAssertResult,
  SerializedSchema,
} from ".";
import {
  ItemPreviewInput,
  PreviewItem,
  ReifiedPreview,
  PreviewScope,
} from "../preview";
import { FieldRender } from "../render";
import {
  createValPathOfItem,
  unsafeCreateSourcePath,
} from "../selector/SelectorProxy";
import { SelectorSource } from "../selector/index";
import { SourceObject } from "../source";
import { ModuleFilePath, SourcePath } from "../val";
import { LiteralSchema, SerializedLiteralSchema } from "./literal";
import { ObjectSchema, SerializedObjectSchema } from "./object";
import {
  ValidationError,
  ValidationErrors,
} from "./validation/ValidationError";

export type SerializedUnionSchema =
  | SerializedStringUnionSchema
  | SerializedObjectUnionSchema;
export type SerializedStringUnionSchema = {
  type: "union";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  key: SerializedLiteralSchema;
  items: SerializedLiteralSchema[];
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};
export type SerializedObjectUnionSchema = {
  type: "union";
  /** Static layout config, carried whole in the serialized schema — see `render.ts`. */
  render?: FieldRender;
  /** Set when this schema declares a `preview`. The closure itself cannot serialize. */
  preview?: true;
  key: string;
  items: SerializedObjectSchema[];
  opt: boolean;
  customValidate?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  description?: string;
};

type SourceOf<
  Key extends string | Schema<string>,
  T extends Schema<
    Key extends string
      ? SourceObject & { [k in Key]: string }
      : Key extends Schema<string>
        ? string
        : unknown
  >[],
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
  >[],
  Src extends SourceOf<Key, T> | null,
> extends Schema<Src> {
  describe(description: string | null): UnionSchema<Key, T, Src> {
    return new UnionSchema<Key, T, Src>(
      this.key,
      this.items,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      description ?? undefined,
      this.renderInput,
      this.previewInput,
    );
  }

  validate(
    validationFunction: (src: Src) => false | string,
  ): UnionSchema<Key, T, Src> {
    return new UnionSchema<Key, T, Src>(
      this.key,
      this.items,
      this.opt,
      this.customValidateFunctions.concat(validationFunction),
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  protected executeValidate(path: SourcePath, src: Src): ValidationErrors {
    const customValidationErrors: ValidationError[] =
      this.executeCustomValidateFunctions(src, this.customValidateFunctions, {
        path,
      });
    const unknownSrc = src as unknown;
    if (this.opt && unknownSrc === null) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : false;
    }

    if (!this.key) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : {
            [path]: [
              ...customValidationErrors,
              {
                message: `Missing required first argument in union`,
                schemaError: true,
              },
            ],
          };
    }

    const key = this.key;
    if (!Array.isArray(this.items)) {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : {
            [path]: [
              ...customValidationErrors,
              {
                message: `A union schema must take more than 1 schema arguments`,
                schemaError: true,
              },
            ],
          };
    }
    if (typeof key === "string") {
      // tagged union
      if (this.items.some((item) => !(item instanceof ObjectSchema))) {
        return customValidationErrors.length > 0
          ? { [path]: customValidationErrors }
          : {
              [path]: [
                ...customValidationErrors,
                {
                  message: `Key is a string, so all schema items must be objects`,
                  schemaError: true,
                },
              ],
            };
      }
      const objectSchemas = this.items as unknown as ObjectSchema<
        {
          [key: string]: Schema<SelectorSource>;
        },
        {
          [key: string]: SelectorSource;
        }
      >[];
      const serializedSchemas = objectSchemas.map((schema) =>
        schema["executeSerialize"](),
      );
      const illegalSchemas = serializedSchemas.filter(
        (schema) =>
          !(schema.type === "object") ||
          !(schema.items[key].type === "literal"),
      );

      if (illegalSchemas.length > 0) {
        return customValidationErrors.length > 0
          ? { [path]: customValidationErrors }
          : {
              [path]: [
                ...customValidationErrors,
                {
                  message: `All schema items must be objects with a key: ${key} that is a literal schema. Found: ${JSON.stringify(
                    illegalSchemas,
                    null,
                    2,
                  )}`,
                  schemaError: true,
                },
              ],
            };
      }
      const serializedObjectSchemas =
        serializedSchemas as SerializedObjectSchema[];
      const optionalLiterals = serializedObjectSchemas.filter(
        (schema) => schema.items[key].opt,
      );
      if (optionalLiterals.length > 1) {
        return customValidationErrors.length > 0
          ? { [path]: customValidationErrors }
          : {
              [path]: [
                ...customValidationErrors,
                {
                  message: `Schema cannot have an optional keys: ${key}`,
                  schemaError: true,
                },
              ],
            };
      }

      if (typeof unknownSrc !== "object") {
        return customValidationErrors.length > 0
          ? { [path]: customValidationErrors }
          : {
              [path]: [
                ...customValidationErrors,
                {
                  message: `Expected an object`,
                  typeError: true,
                },
              ],
            };
      }
      const objectSrc = unknownSrc as { [key: string]: SelectorSource };

      if (objectSrc[key] === undefined) {
        return customValidationErrors.length > 0
          ? { [path]: customValidationErrors }
          : {
              [path]: [
                ...customValidationErrors,
                {
                  message: `Missing required key: ${key}`,
                  typeError: true,
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
            return customValidationErrors.length > 0
              ? { [path]: customValidationErrors }
              : {
                  [path]: [
                    ...customValidationErrors,
                    {
                      message: `Found duplicate key in schema: ${schemaKey.value}`,
                      schemaError: true,
                    },
                  ],
                };
          }
        }
      }
      const objectSchemaAtKey = objectSchemas.find(
        (schema) =>
          !schema["items"][key]["executeValidate"](path, objectSrc[key]),
      );
      if (!objectSchemaAtKey) {
        const keyPath = createValPathOfItem(path, key);
        if (!keyPath) {
          throw new Error(
            `Internal error: could not create path at ${
              !path && typeof path === "string" ? "<empty string>" : path
            } at key ${key}`,
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
                        2,
                      )}`,
                    );
                  }
                })
                .join(", ")}`,
            },
          ],
        };
      }
      const error = objectSchemaAtKey["executeValidate"](path, objectSrc);
      if (error) {
        return error;
      }
    } else if (key instanceof LiteralSchema) {
      if (this.items.some((item) => !(item instanceof LiteralSchema))) {
        return {
          [path]: [
            {
              message: `Key is a literal schema, so all schema items must be literals`,
              typeError: true,
            },
          ],
        };
      }
      const literalItems = [key, ...this.items] as LiteralSchema<string>[];
      if (typeof unknownSrc === "string") {
        const isMatch = literalItems.some(
          (item) => !item["executeValidate"](path, unknownSrc),
        );
        if (!isMatch) {
          return customValidationErrors.length > 0
            ? { [path]: customValidationErrors }
            : {
                [path]: [
                  ...customValidationErrors,
                  {
                    message: `Union must match one of the following: ${literalItems
                      .map((item) => `"${item["value"]}"`)
                      .join(", ")}`,
                  },
                ],
              };
        }
      }
    } else {
      return customValidationErrors.length > 0
        ? { [path]: customValidationErrors }
        : {
            [path]: [
              ...customValidationErrors,
              {
                message: `Expected a string or literal`,
              },
            ],
          };
    }
    return customValidationErrors.length > 0
      ? { [path]: customValidationErrors }
      : false;
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
              message: `Expected 'object', got 'null'`,
              typeError: true,
            },
          ],
        },
      };
    }
    if (!this.key) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `Missing required first argument in union schema`,
              schemaError: true,
            },
          ],
        },
      };
    }
    if (!Array.isArray(this.items)) {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `The schema of this value is wrong. Schema is neither a union of literals nor a tagged union (of objects)`,
              schemaError: true,
            },
          ],
        },
      };
    }
    if (this.key instanceof LiteralSchema) {
      let success = false;
      const errors: Record<SourcePath, AssertError[]> = {};
      for (const itemSchema of [this.key as Schema<string>].concat(
        ...(this.items as Schema<string>[]),
      )) {
        if (!(itemSchema instanceof LiteralSchema)) {
          return {
            success: false,
            errors: {
              [path]: [
                {
                  message: `Schema of value is a union of string, so all schema items must be literals`,
                  schemaError: true,
                },
              ],
            },
          };
        }
        if (typeof src !== "string") {
          errors[path] = [
            {
              message: `Expected 'string', got '${typeof src}'`,
              typeError: true,
            },
          ];
          continue;
        }
        const res = itemSchema["executeAssert"](path, src);
        if (res.success) {
          success = true;
          break;
        } else {
          for (const [key, value] of Object.entries(res.errors)) {
            if (!errors[key as SourcePath]) {
              errors[key as SourcePath] = [];
            }
            errors[key as SourcePath].push(...value);
          }
        }
      }
      if (!success) {
        return {
          success: false,
          errors,
        };
      }
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
    } else if (typeof this.key === "string") {
      let success = false;
      const errors: Record<SourcePath, AssertError[]> = {};
      for (const itemSchema of this.items) {
        const res = itemSchema["executeAssert"](path, src);
        if (res.success) {
          success = true;
          break;
        } else {
          for (const [key, value] of Object.entries(res.errors)) {
            if (!errors[key as SourcePath]) {
              errors[key as SourcePath] = [];
            }
            errors[key as SourcePath].push(...value); // by appending all type errors, we most likely get a lot of duplicate errors. Currently we believe this is correct though, but should probably be handled in when showing the errors to users
          }
        }
      }
      if (!success) {
        return {
          success: false,
          errors,
        };
      }
      return {
        success: true,
        data: src,
      } as SchemaAssertResult<Src>;
    } else {
      return {
        success: false,
        errors: {
          [path]: [
            {
              message: `The schema of this value is wrong. Schema is neither a union of literals nor a tagged union (of objects)`,
              schemaError: true,
            },
          ],
        },
      };
    }
  }

  nullable(): UnionSchema<Key, T, Src | null> {
    // Explicit type args: `previewInput` would otherwise pin inference to `Src`.
    return new UnionSchema<Key, T, Src | null>(
      this.key,
      this.items,
      true,
      [],
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  readonly(): UnionSchema<Key, T, Src> {
    return new UnionSchema(
      this.key,
      this.items,
      this.opt,
      this.customValidateFunctions,
      true,
      this.isHidden,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  hidden(): UnionSchema<Key, T, Src> {
    return new UnionSchema(
      this.key,
      this.items,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      true,
      this.description,
      this.renderInput,
      this.previewInput,
    );
  }

  protected override executeCustomValidateAt(
    path: SourcePath,
    src: Src,
  ): ValidationError[] {
    const errors = this.executeCustomValidateFunctions(
      src,
      this.customValidateFunctions,
      { path },
    );
    // A tagged union's variants share the union's path, so `Internal.resolvePath`
    // stops here and a variant's OWN validator would never be reached. Dispatch
    // into the variant this value takes — the union is the only node that knows
    // which one that is.
    const matched = this.matchedVariant(src);
    if (matched) {
      errors.push(
        ...matched["executeCustomValidateAt"](path, src as SelectorSource),
      );
    }
    return errors;
  }

  /**
   * The variant schema a value takes, for a TAGGED union (string `key`). `null`
   * for a literal union (its variants are leaves with nothing to descend into) or
   * when the value matches none of them — a structural error `executeValidate`
   * already reports.
   */
  private matchedVariant(src: Src): Schema<SelectorSource> | null {
    const key = this.key;
    if (typeof key !== "string" || !Array.isArray(this.items)) {
      return null;
    }
    if (src === null || typeof src !== "object" || Array.isArray(src)) {
      return null;
    }
    const tag = (src as Record<string, unknown>)[key];
    if (typeof tag !== "string") {
      return null;
    }
    const objectSchemas = this.items as unknown as ObjectSchema<
      { [key: string]: Schema<SelectorSource> },
      { [key: string]: SelectorSource }
    >[];
    for (const item of objectSchemas) {
      if (!(item instanceof ObjectSchema)) {
        continue;
      }
      const tagSchema = item["items"][key];
      if (tagSchema instanceof LiteralSchema && tagSchema["value"] === tag) {
        return item as unknown as Schema<SelectorSource>;
      }
    }
    return null;
  }

  /**
   * How this field is laid out in the editor when it is the item of an array
   * or record: `{ as: "inline" }` renders the field itself inside each row,
   * instead of a preview row that navigates to it.
   *
   * Static configuration, not a callback — see `render.ts`.
   */
  render(input: FieldRender): UnionSchema<Key, T, Src> {
    return new UnionSchema<Key, T, Src>(
      this.key,
      this.items,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      input,
      this.previewInput,
    );
  }

  /**
   * How this VALUE is shown where a preview of it is needed — a row in a
   * sortable list, a reference dropdown, a search hit. Never how the field
   * itself is edited (that is `render`). See `preview.ts`.
   *
   * Without one of its own, a tagged union previews as the VARIANT the value
   * takes — declare `preview` on the member objects and the union dispatches.
   */
  preview(select: ItemPreviewInput<Src>): UnionSchema<Key, T, Src> {
    return new UnionSchema<Key, T, Src>(
      this.key,
      this.items,
      this.opt,
      this.customValidateFunctions,
      this.isReadonly,
      this.isHidden,
      this.description,
      this.renderInput,
      select,
    );
  }

  protected override executePreviewItem(
    src: NonNullable<Src>,
  ): PreviewItem | null {
    if (this.previewInput !== null) {
      return this.previewInput({ val: src });
    }
    // Only the union knows which variant the value takes; the variant's own
    // `preview` is what it previews as.
    const matched = this.matchedVariant(src);
    if (matched) {
      return matched["executePreviewItem"](src);
    }
    return null;
  }

  protected override declaresItemPreview(): boolean {
    if (this.previewInput !== null) {
      return true;
    }
    return (
      Array.isArray(this.items) &&
      this.items.some((item) => item["declaresItemPreview"]())
    );
  }

  protected executeSerialize(): SerializedSchema {
    if (typeof this.key === "string") {
      return {
        type: "union",
        render: this.renderInput ?? undefined,
        preview: this.previewInput ? true : undefined,
        key: this.key,
        items: this.items.map((o) => o["executeSerialize"]()),
        opt: this.opt,
        customValidate:
          this.customValidateFunctions &&
          this.customValidateFunctions?.length > 0,
        readonly: this.isReadonly,
        hidden: this.isHidden,
        description: this.description,
      } as SerializedObjectUnionSchema;
    }
    return {
      type: "union",
      render: this.renderInput ?? undefined,
      preview: this.previewInput ? true : undefined,
      key: this.key["executeSerialize"](),
      items: this.items.map((o) => o["executeSerialize"]()),
      opt: this.opt,
      customValidate:
        this.customValidateFunctions &&
        this.customValidateFunctions?.length > 0,
      readonly: this.isReadonly,
      hidden: this.isHidden,
      description: this.description,
    } as SerializedStringUnionSchema;
  }

  constructor(
    private readonly key: Key,
    private readonly items: T,
    private readonly opt: boolean = false,
    private readonly customValidateFunctions: CustomValidateFunction<Src>[] = [],
    private readonly isReadonly: boolean = false,
    private readonly isHidden: boolean = false,
    private readonly description?: string,
    private readonly renderInput: FieldRender | null = null,
    private readonly previewInput: ItemPreviewInput<Src> | null = null,
  ) {
    super();
  }

  protected executePreview(
    sourcePath: SourcePath | ModuleFilePath,
    src: Src,
    scope?: PreviewScope,
  ): ReifiedPreview {
    const res: ReifiedPreview = {};
    if (src === null) {
      return res;
    }
    if (this.key instanceof LiteralSchema) {
      return res;
    }
    const unionKey = this.key;
    if (typeof unionKey === "string") {
      const thisSchema = this.items.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (item): item is ObjectSchema<any, any> => {
          if (item instanceof ObjectSchema) {
            const itemKey = item["items"][unionKey];
            if (itemKey instanceof LiteralSchema) {
              return (
                typeof src === "object" &&
                unionKey in src &&
                itemKey["value"] === src[unionKey]
              );
            }
          }
          return false;
        },
      );
      if (thisSchema) {
        const itemResult = thisSchema["executePreview"](sourcePath, src, scope);
        for (const keyS in itemResult) {
          const key = keyS as SourcePath | ModuleFilePath;
          res[key] = itemResult[key];
        }
        return res;
      }
      res[sourcePath] = {
        status: "error",
        message: `Could not find a matching (object) schema for the union key: ${unionKey}`,
      };
    }
    res[sourcePath] = {
      status: "error",
      message: `The schema of this value is wrong. Expected a object union schema, but union key is not a string. Got: '${JSON.stringify(
        unionKey,
        null,
        2,
      )}'`,
    };
    return res;
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
  >[],
>(
  key: Key,
  ...objects: T
): UnionSchema<Key, T, SourceOf<Key, T>> => {
  return new UnionSchema(key, objects);
};
