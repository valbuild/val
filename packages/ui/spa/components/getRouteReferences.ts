import {
  ModuleFilePath,
  ModuleFilePathSep,
  Source,
  SerializedObjectSchema,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";

/**
 * Find all s.route() fields that have a value matching the given route key
 *
 * This scans all modules to find route fields where the source value equals the routeKey.
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
      // Handle tagged unions
      const schemaKey = schema.key;
      if (typeof schemaKey === "string") {
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
    }
    // Ignore other schema types (string, number, boolean, literal, date, image, file, richtext, keyOf)
  };

  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    go(
      moduleFilePathS as SourcePath,
      schemas[moduleFilePath],
      sources[moduleFilePath],
    );
  }

  return results;
}

function sourcePathConcat(
  sourcePath: SourcePath,
  key: string | number,
): SourcePath {
  if (sourcePath.includes(ModuleFilePathSep)) {
    return `${sourcePath}.${JSON.stringify(key)}` as SourcePath;
  }
  return `${sourcePath}${ModuleFilePathSep}${JSON.stringify(
    key,
  )}` as SourcePath;
}

function isObjectSource(
  source: Source | undefined,
): source is Record<string, Source> {
  return typeof source === "object" && !!source && !Array.isArray(source);
}

function isArrayOfSource(source: Source | undefined): source is Source[] {
  return typeof source === "object" && !!source && Array.isArray(source);
}
