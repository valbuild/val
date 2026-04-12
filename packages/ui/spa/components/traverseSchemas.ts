import {
  Json,
  ModuleFilePath,
  ModuleFilePathSep,
  SerializedArraySchema,
  SerializedObjectSchema,
  SerializedRecordSchema,
  SerializedSchema,
  SerializedUnionSchema,
  Source,
  SourcePath,
} from "@valbuild/core";

export type LeafSerializedSchema = Exclude<
  SerializedSchema,
  | SerializedObjectSchema
  | SerializedArraySchema
  | SerializedUnionSchema
  | SerializedRecordSchema
>;

export type LeafVisitor = (
  sourcePath: SourcePath,
  schema: LeafSerializedSchema,
  source: Source,
) => void;

export function traverseSchemas(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  visit: LeafVisitor,
): void {
  const go = (
    sourcePath: SourcePath,
    schema: SerializedSchema | undefined,
    source: Source,
  ) => {
    if (schema === undefined) {
      console.error(`Schema not found for ${sourcePath}`);
      return;
    }
    if (schema.type === "object" || schema.type === "record") {
      if (isObjectOrRecordSource(source)) {
        for (const key in source) {
          if (key === "patch_id") {
            continue; // skip patch_id as it's not part of the schema and causes issues with remote sources
          }
          // NOTE: for object we are uncertain if we should use the source or the schema to get the keys. Currently we use the schema.items in other places, but source is more correct perhaps? Or perhaps not? We are not sure...
          const sourceValue = (source as Record<string, Source>)[key];
          const schemaValue =
            schema.type === "object" ? schema.items?.[key] : schema.item;
          if (sourceValue) {
            go(sourcePathConcat(sourcePath, key), schemaValue, sourceValue);
          }
        }
      }
    } else if (schema.type === "array") {
      if (isArraySource(source)) {
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
        if (isObjectOrRecordSource(source)) {
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
    } else {
      visit(sourcePath, schema as LeafSerializedSchema, source);
    }
  };
  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    go(
      moduleFilePathS as SourcePath,
      schemas[moduleFilePath],
      sources[moduleFilePath],
    );
  }
}

export function sourcePathConcat(
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

function isObjectOrRecordSource(
  source: Source,
): source is Record<string, Json> {
  return typeof source === "object" && !!source && !Array.isArray(source);
}

function isArraySource(source: Source): source is Json[] {
  return typeof source === "object" && !!source && Array.isArray(source);
}
