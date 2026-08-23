import {
  ModuleFilePath,
  SerializedObjectSchema,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";
import { sourcePathConcat } from "./traverseSchemas";

export type SchemaUsage = {
  /** Where in content the schema is used. */
  sourcePath: SourcePath;
  moduleFilePath: ModuleFilePath;
  /**
   * Every component module whose schema matches the schema at this path.
   *
   * Not necessarily one: two component modules can share a schema, and schemas
   * are matched structurally (see below), so a match is a candidate rather than
   * a proof. Showing all of them is the point - if the project is set up the way
   * it is meant to be, more candidates means more places to review.
   */
  componentPaths: ModuleFilePath[];
};

export type SchemaUsagesResult = {
  usages: SchemaUsage[];
  /** True if `limit` was hit, i.e. the list is incomplete. */
  truncated: boolean;
};

/**
 * Default cap on usages, so a huge site cannot lock up the UI.
 */
const DEFAULT_LIMIT = 200;

/**
 * Finds every place in content where a component module's schema is used.
 *
 * Schemas are compared **structurally**: the serialized schema at a path is
 * compared to the serialized schema of the component module. That is a
 * deliberate trade-off over comparing the schema *instances*:
 *
 * - It works with the data the UI already has (serialized schemas from the sync
 *   engine), so it needs no change to how schemas are extracted or hashed.
 *   Stamping an id into the serialized schema would change `schemaSha`, which
 *   the client and the server have to agree on.
 * - It matches whether the schema was imported or copy-pasted.
 * - It over-matches: two sections that happen to have the same shape look like
 *   the same section. That is why a usage carries every candidate component.
 *
 * It also under-matches in one way worth knowing: a modifier (`.describe()`,
 * `.nullable()`) changes the serialized schema, so a section used with a
 * modifier applied is not recognized as the same schema.
 *
 * Paths inside component modules are skipped: their content is the example
 * content, which the preview shows by default anyway.
 */
export function findSchemaUsages(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  componentPaths: ModuleFilePath[],
  options?: { limit?: number },
): SchemaUsagesResult {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const componentModules = new Set<string>(componentPaths);
  // Serialized component schema -> the component modules that have it
  const byKey = new Map<string, ModuleFilePath[]>();
  const targetTypes = new Set<string>();
  for (const componentPath of componentPaths) {
    const schema = schemas[componentPath];
    if (!schema) {
      continue;
    }
    targetTypes.add(schema.type);
    const key = JSON.stringify(schema);
    const existing = byKey.get(key);
    if (existing) {
      existing.push(componentPath);
    } else {
      byKey.set(key, [componentPath]);
    }
  }
  if (byKey.size === 0) {
    return { usages: [], truncated: false };
  }

  const usages: SchemaUsage[] = [];
  let truncated = false;
  const record = (
    sourcePath: SourcePath,
    moduleFilePath: ModuleFilePath,
    schema: SerializedSchema,
  ) => {
    if (!targetTypes.has(schema.type)) {
      return;
    }
    const matches = byKey.get(JSON.stringify(schema));
    if (!matches) {
      return;
    }
    if (usages.length >= limit) {
      truncated = true;
      return;
    }
    usages.push({
      sourcePath,
      moduleFilePath,
      componentPaths: [...matches],
    });
  };

  const go = (
    sourcePath: SourcePath,
    moduleFilePath: ModuleFilePath,
    schema: SerializedSchema | undefined,
    source: Source,
  ) => {
    if (schema === undefined) {
      return;
    }
    record(sourcePath, moduleFilePath, schema);
    if (schema.type === "object" || schema.type === "record") {
      if (isRecordSource(source)) {
        for (const key in source) {
          if (key === "patch_id") {
            continue;
          }
          const sourceValue = source[key];
          const schemaValue =
            schema.type === "object" ? schema.items?.[key] : schema.item;
          if (sourceValue !== undefined) {
            go(
              sourcePathConcat(sourcePath, key),
              moduleFilePath,
              schemaValue,
              sourceValue,
            );
          }
        }
      }
    } else if (schema.type === "array") {
      if (isArraySource(source)) {
        let i = 0;
        for (const sourceValue of source) {
          go(
            sourcePathConcat(sourcePath, i),
            moduleFilePath,
            schema.item,
            sourceValue,
          );
          i++;
        }
      }
    } else if (schema.type === "union") {
      // String unions have no sub-schemas to descend into
      const schemaKey = schema.key;
      if (typeof schemaKey === "string" && isRecordSource(source)) {
        const itemKey = source[schemaKey];
        if (typeof itemKey === "string") {
          const schemaOfItem = onlyObjectSchemas(schema.items).find((item) => {
            const itemKeySchema = item.items[schemaKey];
            return (
              itemKeySchema?.type === "literal" &&
              itemKeySchema.value === itemKey
            );
          });
          if (schemaOfItem) {
            // Same path: a union does not add a segment, it narrows the schema
            go(sourcePath, moduleFilePath, schemaOfItem, source);
          }
        }
      }
    }
  };

  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    if (componentModules.has(moduleFilePath)) {
      continue;
    }
    const source = sources[moduleFilePath];
    if (source === undefined) {
      continue;
    }
    go(
      moduleFilePath as string as SourcePath,
      moduleFilePath,
      schemas[moduleFilePath],
      source,
    );
  }
  return { usages, truncated };
}

function onlyObjectSchemas(
  schemas: SerializedSchema[],
): SerializedObjectSchema[] {
  const objects: SerializedObjectSchema[] = [];
  for (const schema of schemas) {
    if (schema.type === "object") {
      objects.push(schema);
    }
  }
  return objects;
}

function isRecordSource(source: Source): source is Record<string, Source> {
  return typeof source === "object" && !!source && !Array.isArray(source);
}

function isArraySource(source: Source): source is Source[] {
  return typeof source === "object" && !!source && Array.isArray(source);
}
