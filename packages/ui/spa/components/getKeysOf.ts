import {
  ModuleFilePath,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";
import { traverseSchemas } from "./traverseSchemas";

// TODO: right now we only support keyOf MODULES that are records
// We are planning to add support for keyOf selectors (i.e. nested properties of modules) that are records
// In that case, parent no longer has to be ModuleFilePath, but can be SourcePath, etc...
export function getKeysOf(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  parent: ModuleFilePath,
  keyOfRecord?: string, // NOTE: if this is defined we find keys of this specific record, if not we find all potential references
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
  traverseSchemas(schemas, sources, (sourcePath, schema, source) => {
    if (schema.type === "keyOf") {
      if (schema.path === parentSourcePath) {
        if (keyOfRecord) {
          if (typeof source === "string" && source === keyOfRecord) {
            if (!results.includes(sourcePath)) {
              results.push(sourcePath);
            } else {
              console.error(
                `Duplicate keyOf reference found for ${sourcePath} in ${parent}`,
              );
            }
          }
        } else {
          if (!results.includes(sourcePath)) {
            results.push(sourcePath);
          } else {
            console.error(
              `Duplicate keyOf reference found for ${sourcePath} in ${parent}`,
            );
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
        exhaustiveCheck,
      );
    }
  });
  return results;
}
