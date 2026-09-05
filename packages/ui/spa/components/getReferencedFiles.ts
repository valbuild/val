import {
  Json,
  ModuleFilePath,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";
import { traverseSchemas } from "./traverseSchemas";

export function getReferencedFiles(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  parent: ModuleFilePath,
  fileRef?: string, // if provided, filter to only paths whose source has path === fileRef
): SourcePath[] {
  const results: SourcePath[] = [];
  traverseSchemas(schemas, sources, (sourcePath, schema, source) => {
    if (
      (schema.type === "image" || schema.type === "file") &&
      schema.referencedModule === parent
    ) {
      if (fileRef !== undefined) {
        if (
          typeof source === "object" &&
          source !== null &&
          !Array.isArray(source) &&
          "path" in source &&
          (source as Record<string, Json>).path === fileRef
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
    } else if (
      schema.type === "string" ||
      schema.type === "number" ||
      schema.type === "boolean" ||
      schema.type === "literal" ||
      schema.type === "date" ||
      schema.type === "dateTime" ||
      schema.type === "color" ||
      schema.type === "code" ||
      schema.type === "keyOf" ||
      schema.type === "image" ||
      schema.type === "file" ||
      schema.type === "richtext" ||
      schema.type === "route" ||
      schema.type === "locale"
    ) {
      // ignore these
    } else {
      const exhaustiveCheck: never = schema;
      console.error(
        `Could not get referenced files. Unhandled schema type`,
        exhaustiveCheck,
      );
    }
  });
  return results;
}
