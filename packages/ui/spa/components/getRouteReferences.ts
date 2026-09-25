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
 * Every `s.route()` field in the project, handed to `visit` with its value.
 *
 * The one traversal. Both answers below are built on it because the traversal
 * is what costs: comparing a leaf to a string, or pushing it into a bucket, is
 * free next to reaching the leaf at all.
 *
 * A module whose SCHEMA contains no route field anywhere cannot hold one, so
 * its source is not walked. That test is a walk over the schema - small, fixed,
 * and the same shape for every project - and it replaces a walk over the
 * source, which is the part that grows.
 */
export function walkRouteFields(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  visit: (value: string, sourcePath: SourcePath) => void,
): void {
  const go = (
    sourcePath: SourcePath,
    schema: SerializedSchema | undefined,
    source: Source | undefined,
  ) => {
    if (schema === undefined) {
      return;
    }
    if (Internal.isJson(source)) {
      // Un-loaded `.jsonValues()` entry marker - opaque until loaded.
      return;
    }
    if (schema.type === "route") {
      if (typeof source === "string") {
        visit(source, sourcePath);
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
    // Ignore other schema types (string, number, boolean, literal, enum, date,
    // image, file, richtext, keyOf)
  };

  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (!schemaContainsReferrer(schema, ROUTE_QUERY)) {
      continue;
    }
    go(moduleFilePathS as SourcePath, schema, sources[moduleFilePath]);
  }
}

/**
 * Which `s.route()` fields hold `routeKey`.
 *
 * For one key. Asking about several is what {@link buildRouteReferenceIndex}
 * is for - it is the same walk, and doing it once beats doing it N times.
 */
export function getRouteReferences(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  routeKey: string,
): SourcePath[] {
  const results = new Set<SourcePath>();
  walkRouteFields(schemas, sources, (value, sourcePath) => {
    if (value === routeKey) {
      results.add(sourcePath);
    }
  });
  return [...results];
}

/**
 * Every route value in the project, to the fields that hold it.
 *
 * Built for the question the external pages dialog asks: not "who points at
 * this URL" but "who points at each of these eighteen URLs", which as eighteen
 * separate scans is eighteen traversals of the same tree to compare against a
 * different string each time.
 *
 * It is also the only shape React allows. `useEagerRouteReferences` is a hook,
 * and a hook cannot be called once per item of a list whose length changes -
 * so a per-URL answer in a component rendering N URLs is not merely slower,
 * it is not writable. One hook returning one index is.
 *
 * The index is keyed by the route value as authored, which is what a route
 * field holds and what an external router's record keys are.
 */
export type RouteReferenceIndex = ReadonlyMap<string, SourcePath[]>;

export function buildRouteReferenceIndex(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
): RouteReferenceIndex {
  const index = new Map<string, SourcePath[]>();
  walkRouteFields(schemas, sources, (value, sourcePath) => {
    const existing = index.get(value);
    if (existing === undefined) {
      index.set(value, [sourcePath]);
    } else if (!existing.includes(sourcePath)) {
      // A discriminated union's variant shares the union's own path, so the
      // same leaf can be reached twice.
      existing.push(sourcePath);
    }
  });
  return index;
}

/** What the index says about one value. Absent means nothing points at it. */
export function referencesTo(
  index: RouteReferenceIndex,
  routeKey: string,
): SourcePath[] {
  return index.get(routeKey) ?? [];
}

function isObjectSource(
  source: Source | undefined,
): source is Record<string, Source> {
  return typeof source === "object" && !!source && !Array.isArray(source);
}

function isArrayOfSource(source: Source | undefined): source is Source[] {
  return typeof source === "object" && !!source && Array.isArray(source);
}
