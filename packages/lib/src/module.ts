import { Schema, SchemaTypeOf, SerializedSchema } from "./schema";
import { string } from "./schema/string";
import { object, ObjectSchema, SerializedObjectSchema } from "./schema/object";
import {
  GenericSelector,
  SelectorOf,
  SelectorSource,
  SourceOrExpr,
} from "./selector";
import { Source, SourceArray, SourceObject } from "./source";
import { newSelectorProxy } from "./selector/SelectorProxy";
import { ModuleId, ModulePath, SourcePath } from "./val";
import { Expr } from "./expr";
import { ArraySchema, SerializedArraySchema } from "./schema/array";
import { I18nSchema, SerializedI18nSchema } from "./schema/i18n";
import { UnionSchema, SerializedUnionSchema } from "./schema/union";
import { OneOfSchema, SerializedOneOfSchema } from "./schema/oneOf";
import { Json } from "./Json";

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
  return newSelectorProxy(source, id as SourcePath, schema);
}

{
  const s = object({
    foo: string(),
  });
  const a = content("/id", s, {
    foo: "bar",
  });
}

export function getRawSource(valModule: ValModule<SelectorSource>): Source {
  const sourceOrExpr = valModule[SourceOrExpr];
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

function isArraySchema(
  schema: Schema<SelectorSource> | SerializedSchema
): schema is ArraySchema<Schema<SelectorSource>> | SerializedArraySchema {
  return (
    schema instanceof ArraySchema ||
    (typeof schema === "object" && "type" in schema && schema.type === "array")
  );
}

function isI18nSchema(
  schema: Schema<SelectorSource> | SerializedSchema
): schema is I18nSchema<readonly string[]> | SerializedI18nSchema {
  return (
    schema instanceof I18nSchema ||
    (typeof schema === "object" && "type" in schema && schema.type === "i18n")
  );
}

function isUnionSchema(
  schema: Schema<SelectorSource> | SerializedSchema
): schema is UnionSchema<string, any> | SerializedUnionSchema {
  return (
    schema instanceof UnionSchema ||
    (typeof schema === "object" && "type" in schema && schema.type === "union")
  );
}

function isOneOfSchema(
  schema: Schema<SelectorSource> | SerializedSchema
): schema is OneOfSchema<GenericSelector<SourceArray>> | SerializedOneOfSchema {
  return (
    schema instanceof OneOfSchema ||
    (typeof schema === "object" && "type" in schema && schema.type === "oneOf")
  );
}

export function resolvePath(
  path: ModulePath,
  valModule: ValModule<SelectorSource> | Source,
  schema: Schema<SelectorSource> | SerializedSchema
) {
  const parts = parsePath(path);
  let resolvedSchema = schema;
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
    } else if (isI18nSchema(resolvedSchema)) {
      if (!resolvedSchema.locales.includes(part)) {
        throw Error(
          `Invalid path: i18n schema ${resolvedSchema} supports locales ${resolvedSchema.locales.join(
            ", "
          )}, but found: ${part}`
        );
      }
      if (!Object.keys(resolvedSource).includes(part)) {
        throw Error(
          `Schema type error: expected source to be type of i18n with locale ${part}, but got ${JSON.stringify(
            Object.keys(resolvedSource)
          )}`
        );
      }
      resolvedSource = resolvedSource[part];
      resolvedSchema = resolvedSchema.item;
    } else if (isUnionSchema(resolvedSchema)) {
      const key = resolvedSchema.key;
      const keyValue = resolvedSource[key];
      if (!keyValue) {
        throw Error(
          `Invalid path: union source ${resolvedSchema} did not have required key ${key} in path: ${path}`
        );
      }
      const schemaOfUnionKey = resolvedSchema.items.find(
        (child: any) => child?.items?.[key]?.value === keyValue
      );
      if (!schemaOfUnionKey) {
        throw Error(
          `Invalid path: union schema ${resolvedSchema} did not have a child object with ${key} of value ${keyValue} in path: ${path}`
        );
      }
      resolvedSchema = schemaOfUnionKey.items[part];
      resolvedSource = resolvedSource[part];
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
