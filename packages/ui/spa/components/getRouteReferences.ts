import {
  Internal,
  ModuleFilePath,
  Source,
  SerializedObjectSchema,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { sourcePathOfChild } from "../utils/sourcePath";
import {
  JsonValuesLoadQuery,
  schemaContainsReferrer,
} from "./jsonValuesLoadRequirements";

/** Allocated once: the predicate is called for every module, on every call. */
const ROUTE_QUERY: JsonValuesLoadQuery = { kind: "route" };

/**
 * Find all s.route() fields that have a value matching the given route key.
 *
 * A module whose SCHEMA contains no route field anywhere cannot contain a
 * referrer, so its source is not walked at all. That test is a walk over the
 * schema - small, fixed, and the same shape for every project - while the walk
 * it skips is over the source, which is the part that is megabytes. On a real
 * project most modules are content with no route field in them, and this is
 * called once per route key, so the saving multiplies.
 */
export function getRouteReferences(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  routeKey: string,
): SourcePath[] {
  const results: SourcePath[] = [];

  const go = (
    sourcePath: SourcePath,
    schema: SerializedSchema | undefined,
    source: Source | undefined,
  ) => {
    if (schema === undefined) {
      return;
    }
    if (Internal.isJson(source)) {
      // Un-loaded `.jsonValues()` entry marker — opaque until loaded.
      return;
    }
    if (schema.type === "route") {
      // Check if the source value matches the route key we're looking for
      if (typeof source === "string" && source === routeKey) {
        if (!results.includes(sourcePath)) {
          results.push(sourcePath);
        }
      }
    } else if (schema.type === "object" || schema.type === "record") {
      if (isObjectSource(source)) {
        for (const key in source) {
          const sourceValue = (source as Record<string, Source>)[key];
          const schemaValue =
            schema.type === "object" ? schema.items?.[key] : schema.item;
          if (sourceValue) {
            go(sourcePathOfChild(sourcePath, key), schemaValue, sourceValue);
          }
        }
      }
    } else if (schema.type === "array") {
      if (isArrayOfSource(source)) {
        let i = 0;
        for (const sourceValue of source) {
          go(sourcePathOfChild(sourcePath, i), schema.item, sourceValue);
          i++;
        }
      }
    } else if (schema.type === "discriminated-union") {
      const schemaKey = schema.key;
      if (isObjectSource(source)) {
        const itemKey = (source as Record<string, Source>)[schemaKey];
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
    // Ignore other schema types (string, number, boolean, literal, enum, date, image, file, richtext, keyOf)
  };

  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (!schemaContainsReferrer(schema, ROUTE_QUERY)) {
      continue;
    }
    go(moduleFilePathS as SourcePath, schema, sources[moduleFilePath]);
  }

  return results;
}

function isObjectSource(
  source: Source | undefined,
): source is Record<string, Source> {
  return typeof source === "object" && !!source && !Array.isArray(source);
}

function isArrayOfSource(source: Source | undefined): source is Source[] {
  return typeof source === "object" && !!source && Array.isArray(source);
}
