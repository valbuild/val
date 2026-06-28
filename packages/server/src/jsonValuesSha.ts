import { Internal, Schema, SelectorSource } from "@valbuild/core";

const textEncoder = new TextEncoder();

function hash(input: string): string {
  return Internal.getSHA256Hash(textEncoder.encode(input));
}

/**
 * A small, stable hash of a record's item schema. It is the *schema component*
 * of a json entry's validation sha (see {@link computeJsonEntrySha}). Because it
 * is derived from the serialized item schema, it flips whenever the schema
 * changes — which is how we know every entry of a `.jsonValues()` record must be
 * revalidated after a schema change.
 */
export function getJsonItemSchemaHash(
  itemSchema: Schema<SelectorSource>,
): string {
  return hash(JSON.stringify(itemSchema["executeSerialize"]())).slice(0, 8);
}

/**
 * The validation sha stored in `c.json(thunk, sha)`. It is a composite
 * `"<schemaHash>-<contentHash>"` so that revalidation is required when EITHER:
 * - the entry content changes (the content-hash component flips), or
 * - the item schema changes (the schema-hash component flips → revalidate the
 *   whole record).
 *
 * Validation/commit compares the stored sha against a freshly-computed one and
 * only revalidates on mismatch; the commit flow writes this sha into the
 * `.val.ts`.
 */
export function computeJsonEntrySha(
  itemSchema: Schema<SelectorSource>,
  content: unknown,
): string {
  const schemaHash = getJsonItemSchemaHash(itemSchema);
  const contentHash = hash(JSON.stringify(content ?? null));
  return `${schemaHash}-${contentHash}`;
}

/**
 * Extracts the schema-hash component (the PREFIX) of a composite json entry sha,
 * or `null` if the sha is not in composite form (e.g. a hand-authored sha).
 */
export function getSchemaHashFromJsonSha(sha: string): string | null {
  const idx = sha.indexOf("-");
  return idx === -1 ? null : sha.slice(0, idx);
}

/**
 * Cheap, **content-free** staleness check: does this entry need revalidation
 * purely because the schema changed? Compares the entry's stored sha PREFIX
 * against the current item-schema hash — no `*.val.json` is read. Returns `true`
 * when the schema changed under the entry (prefixes differ) or the stored sha
 * has no schema prefix (can't prove it's current).
 *
 * This is what lets a schema change flag the entries needing revalidation by
 * scanning only the shas already present in the `.val.ts`.
 */
export function jsonEntrySchemaHashIsStale(
  storedSha: string,
  itemSchema: Schema<SelectorSource>,
): boolean {
  const prefix = getSchemaHashFromJsonSha(storedSha);
  return prefix === null || prefix !== getJsonItemSchemaHash(itemSchema);
}

/**
 * True when `content` + `itemSchema` still match `storedSha`, i.e. no
 * revalidation is needed.
 */
export function isJsonEntryShaCurrent(
  storedSha: string,
  itemSchema: Schema<SelectorSource>,
  content: unknown,
): boolean {
  return storedSha === computeJsonEntrySha(itemSchema, content);
}
