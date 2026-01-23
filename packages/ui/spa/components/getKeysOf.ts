import {
  Json,
  ModuleFilePath,
  ModuleFilePathSep,
  SerializedObjectSchema,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { isJsonArray } from "../utils/isJsonArray";

// TODO: right now we only support keyOf MODULES that are records
// We are planning to add support for keyOf selectors (i.e. nested properties of modules) that are records
// In that case, parent no longer has to be ModuleFilePath, but can be SourcePath, etc...
export function getKeysOf(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Json>,
  parent: ModuleFilePath,
  keyOfRecord?: string // NOTE: if this is defined we find keys of this specific record, if not we find all potential references
): SourcePath[] {
  const parentSource = sources[parent];
  if (parentSource === undefined) {
    console.error(`Get keysOf source not found for ${parent}`);
    return [];
  }
  const parentSchema = schemas[parent];
  if (!parentSchema) {
    console.error(`Schema not found for ${parent}`);
    return [];
  }
  const parentSourcePath = parent as unknown as SourcePath;
  const results: SourcePath[] = [];
  const go = (
    sourcePath: SourcePath,
    schema: SerializedSchema | undefined,
    source: Json
  ) => {
    if (schema === undefined) {
      console.error(`Schema not found for ${sourcePath}`);
      return;
    }
    if (schema.type === "keyOf") {
      if (schema.path === parentSourcePath) {
        if (keyOfRecord) {
          if (typeof source === "string" && source === keyOfRecord) {
            if (!results.includes(sourcePath)) {
              results.push(sourcePath);
            } else {
              console.error(
                `Duplicate keyOf reference found for ${sourcePath} in ${parent}`
              );
            }
          }
        } else {
          if (!results.includes(sourcePath)) {
            results.push(sourcePath);
          } else {
            console.error(
              `Duplicate keyOf reference found for ${sourcePath} in ${parent}`
            );
          }
        }
      }
    } else if (schema.type === "object" || schema.type === "record") {
      if (isObjectSource(source) || isRecordSource(source)) {
        for (const key in source) {
          // NOTE: for object we are uncertain if we should use the source or the schema to get the keys. Currently we use the schema.items in other places, but source is more correct perhaps? Or perhaps not? We are not sure...
          const sourceValue = source?.[key];
          const schemaValue =
            schema.type === "object" ? schema.items?.[key] : schema.item;
          if (sourceValue) {
            go(sourcePathConcat(sourcePath, key), schemaValue, sourceValue);
          }
        }
      }
    } else if (schema.type === "array") {
      if (isArrayOfSource(source)) {
        let i = 0;
        for (const sourceValue of source) {
          go(sourcePathConcat(sourcePath, i), schema.item, sourceValue);
          i++;
        }
      }
    } else if (schema.type === "union") {
      // ignore string unions
      const schemaKey = schema.key;
      if (typeof schemaKey === "string") {
        if (isObjectSource(source)) {
          const itemKey = source[schemaKey];
          if (typeof itemKey === "string") {
            const schemaOfItem = (schema.items as SerializedObjectSchema[])
              .filter((item) => item.type === "object")
              .find((item) => {
                const itemKeySchema = item.items[schemaKey];
                if (itemKeySchema?.type === "literal") {
                  return itemKeySchema.value === itemKey;
                }
              });
            if (schemaOfItem) {
              go(sourcePath, schemaOfItem, source);
            }
          }
        }
      }
    } else if (
      schema.type === "string" ||
      schema.type === "number" ||
      schema.type === "boolean" ||
      schema.type === "literal" ||
      schema.type === "date" ||
      schema.type === "image" ||
      schema.type === "file" ||
      schema.type === "richtext" ||
      schema.type === "route"
    ) {
      // ignore these
    } else {
      const exhaustiveCheck: never = schema;
      console.error(
        `Could not get keyOf references. Unhandled schema type`,
        exhaustiveCheck
      );
    }
  };
  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    go(
      moduleFilePathS as SourcePath,
      schemas[moduleFilePath],
      sources[moduleFilePath]
    );
  }
  return results;
}

function sourcePathConcat(
  sourcePath: SourcePath,
  key: string | number
): SourcePath {
  if (sourcePath.includes(ModuleFilePathSep)) {
    return `${sourcePath}.${JSON.stringify(key)}` as SourcePath;
  }
  return `${sourcePath}${ModuleFilePathSep}${JSON.stringify(
    key
  )}` as SourcePath;
}

function isObjectSource(source: Json): source is Record<string, Json> {
  return isRecordSource(source);
}

function isRecordSource(source: Json): source is Record<string, Json> {
  return typeof source === "object" && !!source && !isJsonArray(source);
}

function isArrayOfSource(source: Json): source is Json[] {
  return typeof source === "object" && !!source && isJsonArray(source);
}
