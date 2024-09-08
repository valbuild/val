import { Schema, SelectorOfSchema, SerializedSchema } from "./schema";
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
import { ModuleFilePath, ModulePath, SourcePath } from "./val";
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
import { AllRichTextOptions, RichTextSource } from "./source/richtext";
import { RecordSchema, SerializedRecordSchema } from "./schema/record";
import { RawString } from "./schema/string";
import { ImageSelector } from "./selector/image";
import { ImageSource } from "./source/image";

const brand = Symbol("ValModule");
export type ValModule<T extends SelectorSource> = SelectorOf<T> &
  ValModuleBrand;

export type ValModuleBrand = {
  [brand]: "ValModule";
};

export type InferValModuleType<T extends ValModule<SelectorSource>> =
  T extends GenericSelector<infer S> ? S : never;

export type ReplaceRawStringWithString<T extends SelectorSource> =
  SelectorSource extends T
    ? T
    : T extends RawString
    ? string
    : T extends ImageSelector
    ? ImageSource
    : T extends { [key in string]: SelectorSource }
    ? {
        [key in keyof T]: ReplaceRawStringWithString<T[key]>;
      }
    : T extends SelectorSource[]
    ? ReplaceRawStringWithString<T[number]>[]
    : T;

export function define<T extends Schema<SelectorSource>>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  id: string, // TODO: `/${string}`
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schema: T,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  source: ReplaceRawStringWithString<SelectorOfSchema<T>>
): ValModule<SelectorOfSchema<T>> {
  return {
    [GetSource]: source,
    [GetSchema]: schema,
    [Path]: id as SourcePath,
  } as unknown as ValModule<SelectorOfSchema<T>>;
}

export function getSource(valModule: ValModule<SelectorSource>): Source {
  const sourceOrExpr = valModule[GetSource];
  if (sourceOrExpr instanceof Expr) {
    throw Error("Cannot get raw source of an Expr");
  }
  const source = sourceOrExpr;
  return source;
}

export function splitModuleFilePathAndModulePath(
  path: SourcePath
): [moduleId: ModuleFilePath, path: ModulePath] {
  const pathOfSep = path.indexOf(ModuleFilePathSep);
  if (pathOfSep === -1) {
    return [path as unknown as ModuleFilePath, "" as ModulePath];
  }
  return [
    path.slice(0, pathOfSep) as ModuleFilePath,
    path.slice(pathOfSep + ModuleFilePathSep.length) as ModulePath,
  ];
}

export function joinModuleFilePathAndModulePath(
  moduleFilePath: ModuleFilePath,
  modulePath: ModulePath
): SourcePath {
  return `${moduleFilePath}${ModuleFilePathSep}${modulePath}` as SourcePath;
}

export const ModuleFilePathSep = "?p=";

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
  | Schema<RichTextSource<AllRichTextOptions>>
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

export function resolvePath<
  Src extends ValModule<SelectorSource> | Source,
  Sch extends Schema<SelectorSource> | SerializedSchema
>(
  path: ModulePath,
  valModule: Src,
  schema: Sch
): {
  path: SourcePath;
  schema: Sch;
  source: Src;
} {
  const parts = parsePath(path);
  const origParts = [...parts];
  let resolvedSchema: Schema<SelectorSource> | SerializedSchema = schema;
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
          `Invalid path: array schema ${JSON.stringify(
            resolvedSchema
          )} must have a number as path, but got ${part}. Path: ${path}`
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
      if (resolvedSource[part] === undefined) {
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
          .join(".") as SourcePath, // TODO: create a function generate path from parts (not sure if this always works)
        schema: resolvedSchema as Sch,
        source: resolvedSource,
      };
    } else if (isUnionSchema(resolvedSchema)) {
      const key = resolvedSchema.key;
      if (typeof key !== "string") {
        return {
          path: origParts
            .map((p) => {
              if (!Number.isNaN(Number(p))) {
                return p;
              } else {
                return JSON.stringify(p);
              }
            })
            .join(".") as SourcePath, // TODO: create a function generate path from parts (not sure if this always works)
          schema: resolvedSchema as Sch,
          source: resolvedSource as Src,
        };
      }
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
          .join(".") as SourcePath, // TODO: create a function generate path from parts (not sure if this always works)
        schema: resolvedSchema as Sch,
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
      .join(".") as SourcePath, // TODO: create a function generate path from parts (not sure if this always works)
    schema: resolvedSchema as Sch,
    source: resolvedSource as Src,
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
