import { SerializedSchema } from ".";

/**
 * The branch of an object union that a value takes, by its tag.
 *
 * A union is a fork rather than a level: the branch IS the node, and everything
 * a caller wants to know about that node — its fields, its `locale` field, the
 * schema to draw it with — is on the branch and not on the union. Resolving it
 * takes the source, so it cannot be done from the schema alone, which is why
 * every caller that has only the union ends up needing this.
 *
 * `undefined` where the tag matches nothing, rather than a fallback to the first
 * branch: a value whose tag names no branch is not a member of the union,
 * validation is already saying so, and reading fields out of the wrong shape
 * would answer confidently and wrongly.
 *
 * A string union has no branches to resolve — it is a leaf, and its `key` is a
 * literal schema rather than a field name — so it answers `undefined` too.
 */
export function unionBranchOf(
  schema: SerializedSchema | undefined,
  tag: unknown,
): SerializedSchema | undefined {
  if (schema?.type !== "union" || typeof schema.key !== "string") {
    return undefined;
  }
  for (const item of schema.items) {
    // Narrowed per element: the serialized union is a union of two whole
    // shapes, so knowing `key` is a string says nothing about `items`.
    if (item.type !== "object") {
      continue;
    }
    const discriminator = item.items[schema.key];
    if (discriminator?.type === "literal" && discriminator.value === tag) {
      return item;
    }
  }
  return undefined;
}
