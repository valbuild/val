import {
  FILE_REF_PROP,
  Json,
  ModuleFilePathSep,
  SerializedObjectSchema,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { isJsonArray } from "./isJsonArray";

/**
 * Traverses a schema and source pair, calling a callback for each leaf node.
 * Handles all schema types including primitives, objects, arrays, records, unions, richtext, files, images, etc.
 *
 * @param source - The JSON source data
 * @param schema - The serialized schema
 * @param path - The current source path
 * @param callback - Function called for each traversable node with { source, schema, path }
 */
export function traverseSchemaSource(
  source: Json,
  schema: SerializedSchema,
  path: SourcePath,
  callback: (opts: {
    source: Json;
    schema: SerializedSchema;
    path: SourcePath;
  }) => void
): void {
  if (!schema?.type) {
    throw new Error("Schema not found for " + path);
  }

  if (source === null) {
    return;
  }

  // Handle primitives
  if (schema.type === "string") {
    if (typeof source === "string") {
      callback({ source, schema, path });
    }
    return;
  }

  if (schema.type === "number") {
    if (typeof source === "number") {
      callback({ source, schema, path });
    }
    return;
  }

  if (schema.type === "boolean") {
    if (typeof source === "boolean") {
      callback({ source, schema, path });
    }
    return;
  }

  // Handle richtext - flatten and call callback
  if (schema.type === "richtext") {
    callback({ source, schema, path });
    return;
  }

  // Handle file/image - extract filename from _ref
  if (schema.type === "file" || schema.type === "image") {
    if (
      source &&
      typeof source === "object" &&
      FILE_REF_PROP in source &&
      typeof source[FILE_REF_PROP] === "string"
    ) {
      callback({ source, schema, path });
    }
    return;
  }

  // Handle date
  if (schema.type === "date") {
    if (typeof source === "string") {
      callback({ source, schema, path });
    }
    return;
  }

  // Handle keyOf
  if (schema.type === "keyOf") {
    if (typeof source === "string" || typeof source === "number") {
      callback({ source, schema, path });
    }
    return;
  }

  // Handle literal
  if (schema.type === "literal") {
    callback({ source, schema, path });
    return;
  }

  // Handle route
  if (schema.type === "route") {
    if (typeof source === "string") {
      callback({ source, schema, path });
    }
    return;
  }

  // Handle array
  if (schema.type === "array") {
    if (!Array.isArray(source)) {
      return;
    }
    if (!schema.item) {
      throw new Error(
        "Schema (" + schema.type + ") item not found for " + path
      );
    }
    const isRoot = path.endsWith("?p=");
    for (let i = 0; i < source.length; i++) {
      const subPath = sourcePathConcat(path, i);
      traverseSchemaSource(source[i], schema.item, subPath, callback);
    }
    return;
  }

  // Handle object and record
  if (schema.type === "object" || schema.type === "record") {
    if (typeof source !== "object" || source === null || isJsonArray(source)) {
      return;
    }
    for (const key in source) {
      const subSchema =
        schema.type === "object" ? schema.items?.[key] : schema.item;
      if (!subSchema) {
        continue;
      }
      const subPath = sourcePathConcat(path, key);
      traverseSchemaSource(source[key], subSchema, subPath, callback);
    }
    return;
  }

  // Handle union
  if (schema.type === "union") {
    const schemaKey = schema.key;
    if (typeof schemaKey === "string") {
      // Tagged union - find matching sub-schema
      if (
        source &&
        typeof source === "object" &&
        !isJsonArray(source) &&
        schemaKey in source
      ) {
        const itemKey = source[schemaKey];
        if (typeof itemKey === "string") {
          const schemaOfItem = (schema.items as SerializedObjectSchema[])
            .filter((item) => item.type === "object")
            .find((item) => {
              const itemKeySchema = item.items[schemaKey];
              if (itemKeySchema?.type === "literal") {
                return itemKeySchema.value === itemKey;
              }
              return false;
            });
          if (schemaOfItem) {
            traverseSchemaSource(source, schemaOfItem, path, callback);
          }
        }
      }
    } else {
      // Literal union - treat as primitive
      if (typeof source === "string") {
        callback({ source, schema, path });
      }
    }
    return;
  }

  // Exhaustive check
  const exhaustiveCheck: never = schema;
  throw new Error(
    "Unsupported schema type: " + JSON.stringify(exhaustiveCheck)
  );
}

/**
 * Concatenates a key to a source path, handling root paths correctly.
 */
function sourcePathConcat(
  sourcePath: SourcePath,
  key: string | number
): SourcePath {
  const isRoot = sourcePath.endsWith("?p=");
  if (sourcePath.includes(ModuleFilePathSep)) {
    return `${sourcePath}${isRoot ? "" : "."}${JSON.stringify(
      key
    )}` as SourcePath;
  }
  return `${sourcePath}${ModuleFilePathSep}${JSON.stringify(
    key
  )}` as SourcePath;
}

/**
 * Flattens richtext source to a plain string, extracting only text content.
 * Used for indexing richtext content in search.
 */
export function flattenRichText(source: Json): string {
  let res = "";
  function rec(child: Json): void {
    if (typeof child === "string") {
      res += child;
    } else {
      if (
        child &&
        typeof child === "object" &&
        "children" in child &&
        Array.isArray(child.children)
      ) {
        for (const c of child.children) {
          rec(c);
        }
      }
    }
  }
  rec({ children: source });
  return res;
}
