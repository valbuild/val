import {
  ModuleFilePath,
  SerializedSchema,
  Source,
  SourcePath,
  Internal,
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
    Internal.log.error(`Get keysOf source not found for ${parent}`);
    return [];
  }
  const parentSchema = schemas[parent];
  if (!parentSchema) {
    Internal.log.error(`Schema not found for ${parent}`);
    return [];
  }
  const parentSourcePath = parent as unknown as SourcePath;
  const results: SourcePath[] = [];
  traverseSchemas(
    keyOfScanScope(schemas, parent),
    sources,
    (sourcePath, schema, source) => {
      if (schema.type === "keyOf") {
        if (schema.path === parentSourcePath) {
          if (keyOfRecord) {
            if (typeof source === "string" && source === keyOfRecord) {
              if (!results.includes(sourcePath)) {
                results.push(sourcePath);
              } else {
                Internal.log.error(
                  `Duplicate keyOf reference found for ${sourcePath} in ${parent}`,
                );
              }
            }
          } else {
            if (!results.includes(sourcePath)) {
              results.push(sourcePath);
            } else {
              Internal.log.error(
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
        schema.type === "enum" ||
        schema.type === "date" ||
        schema.type === "dateTime" ||
        schema.type === "color" ||
        schema.type === "code" ||
        schema.type === "image" ||
        schema.type === "file" ||
        schema.type === "video" ||
        schema.type === "richtext" ||
        schema.type === "route" ||
        schema.type === "locale" ||
        // A view holds no source, so it cannot contain a keyOf reference.
        schema.type === "view"
      ) {
        // ignore these
      } else {
        const exhaustiveCheck: never = schema;
        Internal.log.error(
          `Could not get keyOf references. Unhandled schema type`,
          exhaustiveCheck,
        );
      }
    },
  );
  return results;
}

/**
 * The modules a scan for `keyOf`s into `parent` has to walk: those whose
 * schema has one, decided from the schema alone.
 *
 * Every other module is left out of the walk, and that is most of the
 * project: a media library of 10,000 entries cannot hold a `keyOf` anywhere,
 * and walking it on every keystroke of a page that merely points at it was
 * most of a second per character. The answer is kept per schema object, which
 * a module keeps until its code changes.
 */
export function keyOfScanScope(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  parent: ModuleFilePath,
): Record<ModuleFilePath, SerializedSchema> {
  const scope: Record<ModuleFilePath, SerializedSchema> = {};
  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (keyOfTargetsOf(schema).has(parent)) {
      scope[moduleFilePath] = schema;
    }
  }
  return scope;
}

const keyOfTargets = new WeakMap<SerializedSchema, ReadonlySet<string>>();

/** Every path a `keyOf` anywhere inside `schema` points at. */
function keyOfTargetsOf(schema: SerializedSchema): ReadonlySet<string> {
  const known = keyOfTargets.get(schema);
  if (known !== undefined) return known;
  const targets = new Set<string>();
  const go = (node: SerializedSchema | undefined): void => {
    if (node === undefined) return;
    switch (node.type) {
      case "keyOf":
        targets.add(node.path);
        return;
      case "object":
      case "settings":
        for (const key in node.items) go(node.items[key]);
        return;
      case "record":
      case "array":
        go(node.item);
        return;
      case "discriminated-union":
        for (const item of node.items) go(item);
        return;
      default:
        // A leaf: the walk in `getKeysOf` visits nothing below it either.
        return;
    }
  };
  go(schema);
  keyOfTargets.set(schema, targets);
  return targets;
}
