import {
  FILE_REF_PROP,
  Json,
  ModuleFilePath,
  ModuleFilePathSep,
  SerializedObjectSchema,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";

export function getReferencedFiles(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  parent: ModuleFilePath,
  fileRef?: string, // if provided, filter to only paths whose source has _ref === fileRef
): SourcePath[] {
  const results: SourcePath[] = [];
  const go = (
    sourcePath: SourcePath,
    schema: SerializedSchema | undefined,
    source: Source,
  ) => {
    if (schema === undefined) {
      console.error(`Schema not found for ${sourcePath}`);
      return;
    }
    if (
      (schema.type === "image" || schema.type === "file") &&
      schema.referencedModule === parent
    ) {
      if (fileRef !== undefined) {
        if (
          typeof source === "object" &&
          source !== null &&
          !Array.isArray(source) &&
          FILE_REF_PROP in source &&
          (source as Record<string, Json>)[FILE_REF_PROP] === fileRef
        ) {
          if (!results.includes(sourcePath)) {
            results.push(sourcePath);
          }
        }
      } else {
        if (!results.includes(sourcePath)) {
          results.push(sourcePath);
        }
      }
    } else if (schema.type === "object" || schema.type === "record") {
      if (isObjectSource(source) || isRecordSource(source)) {
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
      // ignore string unions
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
    } else if (
      schema.type === "string" ||
      schema.type === "number" ||
      schema.type === "boolean" ||
      schema.type === "literal" ||
      schema.type === "date" ||
      schema.type === "keyOf" ||
      schema.type === "image" ||
      schema.type === "file" ||
      schema.type === "richtext" ||
      schema.type === "route"
    ) {
      // ignore these
    } else {
      const exhaustiveCheck: never = schema;
      console.error(
        `Could not get referenced files. Unhandled schema type`,
        exhaustiveCheck,
      );
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

function isObjectSource(source: Source): source is Record<string, Source> {
  return isRecordSource(source);
}

function isRecordSource(source: Source): source is Record<string, Json> {
  return typeof source === "object" && !!source && !Array.isArray(source);
}

function isArrayOfSource(source: Source): source is Json[] {
  return typeof source === "object" && !!source && Array.isArray(source);
}
