import { Schema, SchemaTypeOf, SerializedSchema } from "./schema";
import { ObjectSchema, SerializedObjectSchema } from "./schema/object";
import {
  GenericSelector,
  SelectorOf,
  SelectorSource,
  GetSource,
  GetSchema,
  Path,
} from "./selector";
import { Source } from "./source";
import { ModuleId, ModulePath, SourcePath } from "./val";
import { Expr } from "./expr";
import { ArraySchema, SerializedArraySchema } from "./schema/array";
import { UnionSchema, SerializedUnionSchema } from "./schema/union";
import { Json } from "./Json";
import { RichTextSchema, SerializedRichTextSchema } from "./schema/richtext";
import {
  ImageMetadata,
  ImageSchema,
  SerializedImageSchema,
} from "./schema/image";
import { FileSource } from "./source/file";
import { AnyRichTextOptions, RichText } from "./source/richtext";
import { RecordSchema, SerializedRecordSchema } from "./schema/record";

const brand = Symbol("ValModule");
export type ValModule<T extends SelectorSource> = SelectorOf<T> &
  ValModuleBrand;

export type ValModuleBrand = {
  [brand]: "ValModule";
};

export type TypeOfValModule<T extends ValModule<SelectorSource>> =
  T extends GenericSelector<infer S> ? S : never;

export function content<T extends Schema<SelectorSource>>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schema: T,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  source: SchemaTypeOf<T>
): ValModule<SchemaTypeOf<T>> {
  return {
    [GetSource]: source,
    [GetSchema]: schema,
    [Path]: id as SourcePath,
  } as unknown as ValModule<SchemaTypeOf<T>>;
}

export function getSource(valModule: ValModule<SelectorSource>): Source {
  const sourceOrExpr = valModule[GetSource];
  if (sourceOrExpr instanceof Expr) {
    throw Error("Cannot get raw source of an Expr");
  }
  const source = sourceOrExpr;
  return source;
}

export function splitModuleIdAndModulePath(
  path: SourcePath
): [moduleId: ModuleId, path: ModulePath] {
  return [
    path.slice(0, path.indexOf(".")) as ModuleId,
    path.slice(path.indexOf(".") + 1) as ModulePath,
  ];
}

export function getSourceAtPath(
  modulePath: ModulePath,
  valModule: ValModule<SelectorSource> | Source
) {
  const parts = parsePath(modulePath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = valModule;
  for (const part of parts) {
    if (typeof current !== "object") {
      throw Error(`Invalid path: ${part} is not an object`);
    }
    current = current[part];
  }
  return current;
}

function isObjectSchema(
  schema: Schema<SelectorSource> | SerializedSchema
): schema is
  | ObjectSchema<{ [key: string]: Schema<SelectorSource> }>
  | SerializedObjectSchema {
  return (
    schema instanceof ObjectSchema ||
    (typeof schema === "object" && "type" in schema && schema.type === "object")
  );
}

function isRecordSchema(
  schema: Schema<SelectorSource> | SerializedSchema
): schema is RecordSchema<Schema<SelectorSource>> | SerializedRecordSchema {
  return (
    schema instanceof RecordSchema ||
    (typeof schema === "object" && "type" in schema && schema.type === "record")
  );
}

function isArraySchema(
  schema: Schema<SelectorSource> | SerializedSchema
): schema is ArraySchema<Schema<SelectorSource>> | SerializedArraySchema {
  return (
    schema instanceof ArraySchema ||
    (typeof schema === "object" && "type" in schema && schema.type === "array")
  );
}

// function isI18nSchema(
//   schema: Schema<SelectorSource> | SerializedSchema
// ): schema is I18nSchema<readonly string[]> | SerializedI18nSchema {
//   return (
//     schema instanceof I18nSchema ||
//     (typeof schema === "object" && "type" in schema && schema.type === "i18n")
//   );
// }

function isUnionSchema(
  schema: Schema<SelectorSource> | SerializedSchema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): schema is UnionSchema<string, any> | SerializedUnionSchema {
  return (
    schema instanceof UnionSchema ||
    (typeof schema === "object" && "type" in schema && schema.type === "union")
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isRichTextSchema(
  schema: Schema<SelectorSource> | SerializedSchema
): schema is
  | Schema<RichText<AnyRichTextOptions>> // TODO: RichTextSchema
  | SerializedRichTextSchema {
  return (
    schema instanceof RichTextSchema ||
    (typeof schema === "object" &&
      "type" in schema &&
      schema.type === "richtext")
  );
}

function isImageSchema(
  schema: Schema<SelectorSource> | SerializedSchema
): schema is
  | ImageSchema<FileSource<ImageMetadata> | null>
  | SerializedImageSchema {
  return (
    schema instanceof ImageSchema ||
    (typeof schema === "object" && "type" in schema && schema.type === "image")
  );
}

// function isOneOfSchema(
//   schema: Schema<SelectorSource> | SerializedSchema
// ): schema is OneOfSchema<GenericSelector<SourceArray>> | SerializedOneOfSchema {
//   return (
//     schema instanceof OneOfSchema ||
//     (typeof schema === "object" && "type" in schema && schema.type === "oneOf")
//   );
// }

export function resolvePath(
  path: ModulePath,
  valModule: ValModule<SelectorSource> | Source,
  schema: Schema<SelectorSource> | SerializedSchema
) {
  const parts = parsePath(path);
  const origParts = [...parts];
  let resolvedSchema = schema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resolvedSource: any /* TODO: any */ = valModule;
  while (parts.length > 0) {
    const part = parts.shift();
    if (part === undefined) {
      throw Error("Unexpected undefined part");
    }
    if (isArraySchema(resolvedSchema)) {
      if (Number.isNaN(Number(part))) {
        throw Error(
          `Invalid path: array schema ${resolvedSchema} must have ${part} a number as path`
        );
      }
      if (
        typeof resolvedSource !== "object" &&
        !Array.isArray(resolvedSource)
      ) {
        throw Error(
          `Schema type error: expected source to be type of array, but got ${typeof resolvedSource}`
        );
      }
      if (!resolvedSource[part]) {
        throw Error(
          `Invalid path: array source (length: ${resolvedSource?.length}) did not have index ${part} from path: ${path}`
        );
      }
      resolvedSource = resolvedSource[part];
      resolvedSchema = resolvedSchema.item;
    } else if (isRecordSchema(resolvedSchema)) {
      if (typeof part !== "string") {
        throw Error(
          `Invalid path: record schema ${resolvedSchema} must have path: ${part} as string`
        );
      }
      if (
        typeof resolvedSource !== "object" &&
        !Array.isArray(resolvedSource)
      ) {
        throw Error(
          `Schema type error: expected source to be type of record, but got ${typeof resolvedSource}`
        );
      }
      if (!resolvedSource[part]) {
        throw Error(
          `Invalid path: record source did not have key ${part} from path: ${path}`
        );
      }
      resolvedSource = resolvedSource[part];
      resolvedSchema = resolvedSchema.item;
    } else if (isObjectSchema(resolvedSchema)) {
      if (typeof resolvedSource !== "object") {
        throw Error(
          `Schema type error: expected source to be type of object, but got ${typeof resolvedSource}`
        );
      }

      if (!resolvedSource[part]) {
        throw Error(
          `Invalid path: object source did not have key ${part} from path: ${path}`
        );
      }
      resolvedSource = resolvedSource[part];
      resolvedSchema = resolvedSchema.items[part];
      // } else if (isI18nSchema(resolvedSchema)) {
      //   if (!resolvedSchema.locales.includes(part)) {
      //     throw Error(
      //       `Invalid path: i18n schema ${resolvedSchema} supports locales ${resolvedSchema.locales.join(
      //         ", "
      //       )}, but found: ${part}`
      //     );
      //   }
      //   if (!Object.keys(resolvedSource).includes(part)) {
      //     throw Error(
      //       `Schema type error: expected source to be type of i18n with locale ${part}, but got ${JSON.stringify(
      //         Object.keys(resolvedSource)
      //       )}`
      //     );
      //   }
      //   resolvedSource = resolvedSource[part];
      //   resolvedSchema = resolvedSchema.item;
    } else if (isImageSchema(resolvedSchema)) {
      return {
        path: origParts
          .slice(0, origParts.length - parts.length - 1)
          .map((p) => JSON.stringify(p))
          .join("."), // TODO: create a function generate path from parts (not sure if this always works)
        schema: resolvedSchema,
        source: resolvedSource,
      };
    } else if (isUnionSchema(resolvedSchema)) {
      const key = resolvedSchema.key;
      const keyValue = resolvedSource[key];
      if (!keyValue) {
        throw Error(
          `Invalid path: union source ${resolvedSchema} did not have required key ${key} in path: ${path}`
        );
      }
      const schemaOfUnionKey = resolvedSchema.items.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (child: any) => child?.items?.[key]?.value === keyValue
      );
      if (!schemaOfUnionKey) {
        throw Error(
          `Invalid path: union schema ${resolvedSchema} did not have a child object with ${key} of value ${keyValue} in path: ${path}`
        );
      }
      resolvedSchema = schemaOfUnionKey.items[part];
      resolvedSource = resolvedSource[part];
    } else if (isRichTextSchema(resolvedSchema)) {
      return {
        path: origParts
          .slice(0, origParts.length - parts.length - 1)
          .map((p) => JSON.stringify(p))
          .join("."), // TODO: create a function generate path from parts (not sure if this always works)
        schema: resolvedSchema,
        source: resolvedSource,
      };
    } else {
      throw Error(
        `Invalid path: ${part} resolved to an unexpected schema ${JSON.stringify(
          resolvedSchema
        )}`
      );
    }
  }
  if (parts.length > 0) {
    throw Error(`Invalid path: ${parts.join(".")} is not a valid path`);
  }
  return {
    path: origParts
      .map((p) => {
        if (!Number.isNaN(Number(p))) {
          return p;
        } else {
          return JSON.stringify(p);
        }
      })
      .join("."), // TODO: create a function generate path from parts (not sure if this always works)
    schema: resolvedSchema,
    source: resolvedSource,
  };
}

export function parsePath(input: ModulePath) {
  const result = [];
  let i = 0;

  while (i < input.length) {
    let part = "";

    if (input[i] === '"') {
      // Parse a quoted string
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && input[i + 1] === '"') {
          // Handle escaped double quotes
          part += '"';
          i++;
        } else {
          part += input[i];
        }
        i++;
      }
      if (input[i] !== '"') {
        throw new Error(
          `Invalid input (${JSON.stringify(
            input
          )}): Missing closing double quote: ${
            input[i] ?? "at end of string"
          } (char: ${i}; length: ${input.length})`
        );
      }
    } else {
      // Parse a regular string
      while (i < input.length && input[i] !== ".") {
        part += input[i];
        i++;
      }
    }

    if (part !== "") {
      result.push(part);
    }

    i++;
  }

  return result;
}

export type SerializedModule = {
  source: Json;
  schema: SerializedSchema;
  path: SourcePath;
};
