import { SerializedSchema } from ".";

/**
 * The keys a record is REQUIRED to hold, where its key schema says what they are.
 *
 * Most records have an open key set — `s.record(s.string(), item)` holds
 * whatever anyone adds — and this returns `null` for those. A record keyed by
 * something that enumerates its values is different in kind: the keys are part
 * of the schema, so a missing one is a hole in the content rather than content
 * nobody has written yet.
 *
 * Two key schemas enumerate. A union of literals does it locally, so its keys
 * are here. `s.locale()` does it in the settings module, which is another file
 * and so cannot be read from a serialized schema — those carry the alias table
 * instead and are resolved against `locales.available` by
 * `resolveSchemaSourceFixes`, the same crossing `keyOf` and `route` make.
 */
export type DeclaredKeySet =
  | { kind: "literals"; keys: string[] }
  | { kind: "locale"; aliases?: Record<string, string[]> };

/**
 * What `key` requires a record to hold, or `null` where it requires nothing.
 *
 * Works from the SERIALIZED schema so that the Studio, the validation worker
 * and the server all answer this the same way — none of them has the schema
 * instance, and `SchemaStore` deliberately holds serialized schemas only.
 */
export function declaredKeySetOf(
  key: SerializedSchema | undefined,
): DeclaredKeySet | null {
  if (key === undefined) {
    return null;
  }
  if (key.type === "literal") {
    return { kind: "literals", keys: [key.value] };
  }
  if (key.type === "union") {
    // The object form (`s.union("type", …)`) discriminates objects and cannot
    // be a record key at all — only the string form reaches this.
    if (typeof key.key === "string") {
      return null;
    }
    return {
      kind: "literals",
      // `items` is narrowed per element rather than by the branch above: the
      // serialized union is a union of two whole shapes, so knowing `key` is a
      // literal does not tell TypeScript anything about `items`.
      keys: [
        key.key.value,
        ...key.items.flatMap((item) =>
          item.type === "literal" ? [item.value] : [],
        ),
      ],
    };
  }
  if (key.type === "locale") {
    return { kind: "locale", aliases: key.aliases };
  }
  return null;
}

/**
 * The declared keys a record is missing, in the order the schema declares them.
 *
 * Declaration order rather than the source's: this is read as "what is left to
 * write", and the answer should not reshuffle itself as entries are added.
 */
export function missingDeclaredKeys(
  declared: readonly string[],
  present: readonly string[],
): string[] {
  return declared.filter((key) => !present.includes(key));
}
