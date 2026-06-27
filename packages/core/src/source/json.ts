import { PhantomType, VAL_EXTENSION } from ".";
import { Json } from "../Json";

/**
 * The string used as the `_type` discriminator of a {@link JsonSource}.
 */
export const JSON_VAL_EXTENSION_TAG = "json" as const;

/**
 * The lazy import thunk a {@link JsonSource} carries at runtime. It is NOT part
 * of the {@link JsonSource} type because `Source` must stay JSON-serializable
 * (it is sent over the wire as `Json`); the thunk is a runtime-only detail,
 * read via {@link getJsonImport}.
 */
export type JsonImportThunk<T = unknown> = () => Promise<{ default: T }>;

/**
 * A JSON source represents a record/router entry whose value is stored in a
 * separate `*.val.json` file and loaded lazily via a dynamic `import()` thunk.
 *
 * This is what `c.json(() => import("./entry.val.json"), "<contentSha>")` returns.
 *
 * The *type* is a pure-JSON marker (`{ _type: "json", _sha, patch_id? }`) so that
 * `Source` stays JSON-serializable. At runtime the value additionally carries a
 * lazy import thunk (read via {@link getJsonImport}); over the wire only the
 * marker is sent.
 *
 * The phantom type parameter `T` is the (loosened, see {@link JsonOf}) type of
 * the value the JSON file resolves to. It is covariant: a `JsonSource` of a
 * narrower value type is assignable to a `JsonSource` of a wider one.
 */
export type JsonSource<T = unknown> = {
  readonly [VAL_EXTENSION]: typeof JSON_VAL_EXTENSION_TAG;
  /** Content hash of the backing JSON, used as a validation-cache key. */
  readonly _sha: string;
  /** Set on uncommitted/draft entries (mirrors FileSource/RemoteSource). */
  readonly patch_id?: string;
} & PhantomType<T>;

export function json<T = Json>(
  importThunk: JsonImportThunk<T>,
  sha: string,
): JsonSource<T> {
  return {
    [VAL_EXTENSION]: JSON_VAL_EXTENSION_TAG,
    // runtime-only: not described by JsonSource so Source stays JSON-serializable
    _import: importThunk,
    _sha: sha,
  } as unknown as JsonSource<T>;
}

export function isJson(obj: unknown): obj is JsonSource {
  return (
    typeof obj === "object" &&
    obj !== null &&
    VAL_EXTENSION in obj &&
    (obj as { [VAL_EXTENSION]?: unknown })[VAL_EXTENSION] ===
      JSON_VAL_EXTENSION_TAG
  );
}

/**
 * Reads the runtime-only lazy import thunk from a {@link JsonSource}. Returns
 * `undefined` for a transport marker (sent over the wire without the thunk).
 */
export function getJsonImport(source: JsonSource): JsonImportThunk | undefined {
  const candidate = (source as { _import?: unknown })._import;
  return typeof candidate === "function"
    ? (candidate as JsonImportThunk)
    : undefined;
}

/**
 * Loosens a (strict) schema source type `T` into the type that a
 * `resolveJsonModule` import of the backing `*.val.json` can actually satisfy.
 *
 * Why this is needed: TypeScript widens literals when it infers the type of a
 * JSON module (e.g. `"a"` becomes `string`, `1` becomes `number`, and a branded
 * `_type: "file"` becomes `_type: string`). A strict schema type (with literal
 * unions, `RawString` brands, etc.) would therefore reject a perfectly valid
 * JSON file. `JsonOf<T>` performs the same widening at the type level so the
 * JSON content typechecks against the schema as strictly as JSON allows. Runtime
 * validation enforces the rest.
 *
 * The transform distributes over unions and recurses through objects/arrays,
 * preserving structure while widening every leaf literal. Val object-unions are
 * always discriminated, so distribute-and-recurse is sufficient (the discriminant
 * literal widens to its base type, but the per-variant shape stays distinct and a
 * concrete JSON value still matches exactly one variant).
 */
export type JsonOf<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null
        ? null
        : T extends undefined
          ? undefined
          : T extends readonly (infer E)[]
            ? JsonOf<E>[]
            : T extends object
              ? { [K in keyof T]: JsonOf<T[K]> }
              : T;
