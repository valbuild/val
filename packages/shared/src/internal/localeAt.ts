import {
  Internal,
  localeOfValue,
  type Json,
  type JsonObject,
  type SerializedSchema,
  type SourcePath,
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
 * keyed by `s.locale()`, and a locale segment in a segmented key. Once this can
 * be answered from the schema and the source alone, everything downstream falls
 * out of it — the Studio's locale filter, deep links, `<html lang>`, and knowing
 * what to translate from and into.
 *
 * One implementation, so the Studio, the server and the validation worker cannot
 * disagree about what language a piece of content is in.
 *
 * The answer is the canonical tag, never the stored spelling. With
 * `.aliases({ "nb-NO": "no" })` a key reads `no` and this returns `nb-NO`,
 * because that is what goes into `<html lang>`, into `Intl` and into a
 * comparison against `locales.available`.
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
  return walk(schema, source, segments, available);
}

/**
 * Walk from a node towards `segments`, answering with the innermost scope.
 *
 * The scope is read on the way DOWN, at each node, before the next segment is
 * taken — so `localeAt` of a scope-opening object is that object's own locale,
 * not its parent's. A scope may not contain another (see `localeScopeErrors`),
 * so at most one of these can fire on a well-formed path; taking the innermost
 * is what makes the answer well-defined while a project is mid-fix.
 */
function walk(
  schema: SerializedSchema,
  source: Json,
  segments: string[],
  available: string[],
): string | null {
  let locale = localeOfObjectField(schema, source, available);
  let currentSchema: SerializedSchema | undefined = schema;
  let currentSource: Json = source;
  for (const segment of segments) {
    if (currentSchema === undefined) {
      return locale;
    }
    if (currentSchema.type === "union") {
      // An object union is a fork, not a level: the branch the value takes IS
      // the node the next segment comes out of, and the branch is an object
      // that may itself carry the locale field. Resolve it before descending,
      // or a scope declared on one branch would be walked straight past.
      currentSchema = branchOfUnion(currentSchema, currentSource);
      if (currentSchema === undefined) {
        return locale;
      }
      const opened = localeOfObjectField(
        currentSchema,
        currentSource,
        available,
      );
      if (opened !== null) {
        locale = opened;
      }
    }
    if (currentSchema.type === "record") {
      if (currentSchema.key?.type === "locale") {
        // In a locale-keyed record the KEY is the language, so the segment we
        // are about to take is the answer.
        const resolved = localeOfValue(
          segment,
          available,
          currentSchema.key.aliases,
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
    if (currentSchema !== undefined) {
      const opened = localeOfObjectField(
        currentSchema,
        currentSource,
        available,
      );
      if (opened !== null) {
        locale = opened;
      }
    }
  }
  return locale;
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
    if (item.type !== "locale") {
      continue;
    }
    const value = source[key];
    if (typeof value !== "string") {
      return null;
    }
    return localeOfValue(value, available, item.aliases);
  }
  return null;
}

/**
 * The union branch a value takes, by its tag, or `undefined` if none does.
 *
 * No fallback to "the first branch": if the tag matches nothing the value is
 * not a valid member of the union, validation is already saying so, and picking
 * a branch anyway would report a language read out of the wrong shape.
 */
function branchOfUnion(
  schema: SerializedSchema & { type: "union" },
  source: Json,
): SerializedSchema | undefined {
  const key = schema.key;
  if (typeof key !== "string") {
    // A string union is a leaf: there is nothing under it to walk into.
    return undefined;
  }
  if (!isJsonObject(source)) {
    return undefined;
  }
  const tag = source[key];
  for (const item of schema.items) {
    // Narrowed per element: the serialized union is a union of two whole
    // shapes, so knowing `key` is a string says nothing about `items`.
    if (item.type !== "object") {
      continue;
    }
    const discriminator = item.items[key];
    if (discriminator?.type === "literal" && discriminator.value === tag) {
      return item;
    }
  }
  return undefined;
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
