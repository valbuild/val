import {
  Internal,
  localeOfValue,
  matchRoutePattern,
  routePatternOf,
  type Json,
  type JsonObject,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
  discriminatedUnionBranchOf,
} from "@valbuild/core";
import {
  declaredLocales,
  type SchemaSourceSnapshot,
} from "./resolveSchemaSourceFixes";

/**
 * Which of the project's languages governs a path, or `null` for none.
 *
 * THE question the whole feature turns on. A locale scope is a subtree in one
 * language, and three things open one: a `locale` field on an object, a record
 * keyed by `s.locale()`, and a locale parameter in a router's key
 * (`s.router(router, { locale: … }, item)`, where the URL names the language). Once this can
 * be answered from the schema and the source alone, everything downstream falls
 * out of it — the Studio's locale filter, deep links, `<html lang>`, and knowing
 * what to translate from and into.
 *
 * One implementation, so the Studio, the server and the validation worker cannot
 * disagree about what language a piece of content is in.
 *
 * `null` means no scope governs the path — which is the answer for most content
 * in most projects, and for every project that has not declared any languages.
 */
export function localeAt(
  path: SourcePath,
  snapshot: SchemaSourceSnapshot,
): string | null {
  const available = declaredLocales(snapshot);
  if (available.length === 0) {
    // Nothing can be one of no languages. Answering `null` rather than reading
    // the content is also what makes this cheap for the projects that are not
    // translated at all.
    return null;
  }
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const schema = snapshot.schemas[moduleFilePath];
  const source = snapshot.sources[moduleFilePath];
  if (schema === undefined || source === undefined) {
    return null;
  }
  const segments = modulePath ? Internal.splitModulePath(modulePath) : [];
  return walk(
    schema,
    source,
    segments,
    available,
    moduleFilePath as ModuleFilePath,
  );
}

/**
 * The language a locale schema's value MEANS, or `null` if it means none of
 * the project's.
 *
 * `s.locale()` stores the tag itself. An enum with `.locales(...)` stores a
 * value that stands for one — `nb` for `nb-NO` — and, on a router parameter,
 * `null` for a URL that left the segment out, which `{ null: tag }` names.
 * Anything else is not a locale and means nothing here.
 *
 * Callers reading a FIELD pass only strings: a field that holds `null` has no
 * language, whatever its schema says about URLs.
 */
export function localeMeantBy(
  schema: SerializedSchema,
  value: string | null,
  available: readonly string[],
): string | null {
  if (schema.type === "locale") {
    return value === null ? null : localeOfValue(value, available);
  }
  if (schema.type === "enum" && schema.locales !== undefined) {
    const tag = value === null ? schema.nullLocale : schema.locales[value];
    return tag === undefined ? null : localeOfValue(tag, available);
  }
  return null;
}

/**
 * Whether a schema is a locale: `s.locale()`, or an enum `.locales(...)` made
 * one.
 */
export function isLocaleSchema(schema: SerializedSchema): boolean {
  return (
    schema.type === "locale" ||
    (schema.type === "enum" && schema.locales !== undefined)
  );
}

/**
 * The language a router's key is in, where one of its route parameters is a
 * locale — `/nb/blog/hei` is `nb-NO` when `locale` maps `nb` to it.
 */
function localeOfRouteKey(
  schema: SerializedSchema & { type: "record" },
  moduleFilePath: ModuleFilePath,
  key: string,
  available: string[],
): string | null {
  if (schema.params === undefined || schema.router === undefined) {
    return null;
  }
  const pattern = routePatternOf(schema.router, moduleFilePath);
  if (pattern === null) {
    return null;
  }
  const values = matchRoutePattern(key, pattern);
  if (values === null) {
    return null;
  }
  for (const [name, param] of Object.entries(schema.params)) {
    if (isLocaleSchema(param) && name in values) {
      return localeMeantBy(param, values[name], available);
    }
  }
  return null;
}

/**
 * Walk from a node towards `segments`, answering with the innermost scope.
 *
 * The scope is read on ARRIVAL at each node — the node the path names included,
 * not only the ones passed through on the way to it. So `localeAt` of a
 * scope-opening object is that object's own locale rather than its parent's,
 * and a path that stops AT a block still answers with the block's language.
 *
 * A scope may not contain another (see `localeScopeErrors`), so at most one of
 * these can fire on a well-formed path; taking the innermost is what makes the
 * answer well-defined while a project is mid-fix.
 */
function walk(
  schema: SerializedSchema,
  source: Json,
  segments: string[],
  available: string[],
  moduleFilePath: ModuleFilePath,
): string | null {
  let entered = enter(schema, source, available);
  let locale = entered.locale;
  let currentSchema: SerializedSchema | undefined = entered.schema;
  let currentSource: Json = source;
  for (const segment of segments) {
    if (currentSchema === undefined) {
      return locale;
    }
    if (currentSchema.type === "record") {
      if (
        currentSchema.key !== undefined &&
        isLocaleSchema(currentSchema.key)
      ) {
        // In a locale-keyed record the KEY is the language, so the segment we
        // are about to take is the answer — the tag itself for `s.locale()`,
        // the tag it stands for when the key is an enum with `.locales()`.
        const resolved = localeMeantBy(currentSchema.key, segment, available);
        if (resolved !== null) {
          locale = resolved;
        }
      } else if (currentSchema.params !== undefined) {
        // A router whose URL names the language: the key is a URL, and one of
        // its parameters is the answer.
        const resolved = localeOfRouteKey(
          currentSchema,
          moduleFilePath,
          segment,
          available,
        );
        if (resolved !== null) {
          locale = resolved;
        }
      }
      currentSchema = currentSchema.item;
    } else if (currentSchema.type === "array") {
      currentSchema = currentSchema.item;
    } else if (
      currentSchema.type === "object" ||
      currentSchema.type === "settings"
    ) {
      currentSchema = currentSchema.items[segment];
    } else {
      // A leaf, or richtext's internal structure. Nothing below opens a scope.
      return locale;
    }
    currentSource = childSource(currentSource, segment);
    entered = enter(currentSchema, currentSource, available);
    currentSchema = entered.schema;
    if (entered.locale !== null) {
      locale = entered.locale;
    }
  }
  return locale;
}

/**
 * Arrive at a node: resolve what it really is, and read the scope it opens.
 *
 * A discriminated union is a fork rather than a level — the variant the value
 * takes IS the node — so it is resolved here, before anything asks what the
 * node holds. Doing that on arrival rather than on the way down is the
 * difference between a block's own path answering with its language and
 * answering with nothing.
 */
function enter(
  schema: SerializedSchema | undefined,
  source: Json,
  available: string[],
): { schema: SerializedSchema | undefined; locale: string | null } {
  const resolved =
    schema?.type === "discriminated-union"
      ? variantOfUnion(schema, source)
      : schema;
  return {
    schema: resolved,
    locale:
      resolved === undefined
        ? null
        : localeOfObjectField(resolved, source, available),
  };
}

/**
 * The language an object's own `locale` field says it is in, if it has one.
 *
 * Reads the SOURCE, since unlike a record key the value is content rather than
 * part of the path. A field that has not been filled in, or holds something
 * that is not one of the project's languages, is not an answer — validation is
 * already reporting that, and guessing here would put a language in
 * `<html lang>` that nobody chose.
 */
function localeOfObjectField(
  schema: SerializedSchema,
  source: Json,
  available: string[],
): string | null {
  if (schema.type !== "object" || !isJsonObject(source)) {
    return null;
  }
  for (const [key, item] of Object.entries(schema.items)) {
    if (!isLocaleSchema(item)) {
      continue;
    }
    const value = source[key];
    if (typeof value !== "string") {
      return null;
    }
    return localeMeantBy(item, value, available);
  }
  return null;
}

/**
 * The variant a value takes, or `undefined` if the tag matches none.
 *
 * The tag is read off the source here; picking the variant is
 * {@link discriminatedUnionBranchOf}, shared with the Studio's locale filter so
 * the two cannot disagree about which variant a row is. `s.enum()` never
 * reaches this — it is a leaf, with nothing under it to walk into.
 */
function variantOfUnion(
  schema: SerializedSchema & { type: "discriminated-union" },
  source: Json,
): SerializedSchema | undefined {
  if (!isJsonObject(source)) {
    return undefined;
  }
  return discriminatedUnionBranchOf(schema, source[schema.key]);
}

/** The child of a source value at a segment, or `null` where there is none. */
function childSource(source: Json, segment: string): Json {
  if (Array.isArray(source)) {
    const index = Number(segment);
    return Number.isInteger(index) ? (source[index] ?? null) : null;
  }
  if (!isJsonObject(source)) {
    return null;
  }
  return source[segment] ?? null;
}

/**
 * Whether `source` is a JSON object rather than an array or a primitive.
 *
 * A type predicate rather than the inline checks, because `Array.isArray` does
 * NOT narrow `JsonArray` out of `Json` — it is `readonly Json[]`, and the
 * built-in guard only narrows mutable arrays. Without this, every read of a
 * property would need an assertion.
 */
function isJsonObject(source: Json): source is JsonObject {
  return (
    typeof source === "object" && source !== null && !Array.isArray(source)
  );
}
