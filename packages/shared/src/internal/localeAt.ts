import {
  Internal,
  localeOfValue,
  type Json,
  type JsonObject,
  type SerializedSchema,
  type SourcePath,
  unionBranchOf,
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
 * A union is a fork rather than a level — the branch the value takes IS the
 * node — so it is resolved here, before anything asks what the node holds.
 * Doing that on arrival rather than on the way down is the difference between
 * a block's own path answering with its language and answering with nothing.
 */
function enter(
  schema: SerializedSchema | undefined,
  source: Json,
  available: string[],
): { schema: SerializedSchema | undefined; locale: string | null } {
  const resolved =
    schema?.type === "union" ? branchOfUnion(schema, source) : schema;
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
 * The union branch a value takes, or `undefined` if the tag matches none.
 *
 * The tag is read off the source here; picking the branch is
 * {@link unionBranchOf}, shared with the Studio's locale filter so the two
 * cannot disagree about which branch a row is.
 */
function branchOfUnion(
  schema: SerializedSchema & { type: "union" },
  source: Json,
): SerializedSchema | undefined {
  const key = schema.key;
  if (typeof key !== "string" || !isJsonObject(source)) {
    // A string union is a leaf: there is nothing under it to walk into.
    return undefined;
  }
  return unionBranchOf(schema, source[key]);
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
