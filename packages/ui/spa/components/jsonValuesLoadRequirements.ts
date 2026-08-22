import {
  ModuleFilePath,
  SerializedObjectSchema,
  SerializedRecordSchema,
  SerializedSchema,
} from "@valbuild/core";

/**
 * What a reference scan is looking for. Note the asymmetry: `keyOf` and
 * `file` name the module they point AT, so they can be matched exactly, while a
 * `route` field records no target module at all (`SerializedRouteSchema` only
 * carries include/exclude patterns) and `getRouteReferences` matches by comparing
 * the field's string VALUE to the route key.
 */
export type JsonValuesLoadQuery =
  | { kind: "keyOf"; module: ModuleFilePath }
  | { kind: "file"; module: ModuleFilePath }
  | { kind: "route" };

/**
 * Which `.jsonValues()` modules must have their entry CONTENT loaded before a
 * reference scan for `query` can be trusted — decided from the schemas alone, so
 * it costs nothing and needs no sources.
 *
 * Direction is what makes this cheap. A scan for references TO a module finds
 * referrers, which are `keyOf`/`route`/file fields living somewhere else. The
 * scanned record's own key set is always available (an un-loaded entry is still a
 * marker under its key), so the only content a scan can be blind to is content
 * that itself POINTS OUTWARD — i.e. a jsonValues record whose item schema
 * contains a matching referrer, as in:
 *
 * ```ts
 * s.record(s.object({ test: s.keyOf(otherModule) })).jsonValues()
 * ```
 *
 * In the overwhelmingly common case the result is empty: nothing to load, and the
 * scan is complete and correct immediately.
 *
 * `route` is the one over-approximation — since the schema does not say which
 * router a `s.route()` field points into, ANY jsonValues record containing a
 * route field has to be loaded.
 */
export function jsonValuesLoadRequirements(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  query: JsonValuesLoadQuery,
): ModuleFilePath[] {
  const required: ModuleFilePath[] = [];
  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (!isJsonValuesModule(schema)) {
      continue;
    }
    if (containsReferrer(schema.item, query, new Set())) {
      required.push(moduleFilePath);
    }
  }
  return required;
}

/**
 * Every module whose root is a `.jsonValues()` record — i.e. every module that can
 * hold un-loaded content at all.
 *
 * The scoping rule above cannot help a consumer that needs ALL content: search
 * indexes every value by definition. This is that honest full set, and the reason
 * search (alone) needs a visible progress indicator.
 */
export function allJsonValuesModules(
  schemas: Record<ModuleFilePath, SerializedSchema>,
): ModuleFilePath[] {
  const modules: ModuleFilePath[] = [];
  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    if (isJsonValuesModule(schemas[moduleFilePath])) {
      modules.push(moduleFilePath);
    }
  }
  return modules;
}

/**
 * `.jsonValues()` is root-only (locked decision #7), so only a module whose ROOT
 * is a jsonValues record can hold un-loaded content.
 */
function isJsonValuesModule(
  schema: SerializedSchema | undefined,
): schema is SerializedRecordSchema {
  return (
    schema !== undefined &&
    schema.type === "record" &&
    schema.jsonValues === true
  );
}

/**
 * True when `schema` can hold a field that {@link JsonValuesLoadQuery} would
 * match, looking through objects, arrays, records and unions.
 *
 * `seen` guards against a schema that (however unusually) refers to itself
 * structurally, so this cannot recurse forever.
 */
function containsReferrer(
  schema: SerializedSchema | undefined,
  query: JsonValuesLoadQuery,
  seen: Set<SerializedSchema>,
): boolean {
  if (schema === undefined || seen.has(schema)) {
    return false;
  }
  seen.add(schema);
  switch (schema.type) {
    case "keyOf":
      // `keyOf.path` is the referenced record's path; for a module-level record
      // that is the module file path itself (the same comparison `getKeysOf`
      // makes).
      // Compared as plain strings: `keyOf.path` is branded `SourcePath` and the
      // query carries a `ModuleFilePath`, but for a module-level record they are
      // the same string (which is the comparison `getKeysOf` makes too).
      return query.kind === "keyOf" && sameString(schema.path, query.module);
    case "image":
    case "file":
      return query.kind === "file" && schema.referencedModule === query.module;
    case "route":
      return query.kind === "route";
    case "object":
      return Object.values(schema.items).some((item) =>
        containsReferrer(item, query, seen),
      );
    case "array":
    case "record":
      return containsReferrer(schema.item, query, seen);
    case "union":
      // Covers both the tagged form (object variants) and the literal form,
      // whose items are literals and match nothing.
      return (
        schema.items as (SerializedObjectSchema | SerializedSchema)[]
      ).some((item) => containsReferrer(item, query, seen));
    case "string":
    case "number":
    case "boolean":
    case "literal":
    case "date":
    case "dateTime":
    case "svg":
    case "richtext":
      return false;
    default: {
      const exhaustiveCheck: never = schema;
      console.error(
        "Could not compute jsonValues load requirements. Unhandled schema type",
        exhaustiveCheck,
      );
      // Conservative: an unknown schema type might hold a referrer, and
      // wrongly reporting "nothing to load" is what makes a guard lie.
      return true;
    }
  }
}

/** Compares two branded strings without asserting one into the other's brand. */
function sameString(a: string, b: string): boolean {
  return a === b;
}
