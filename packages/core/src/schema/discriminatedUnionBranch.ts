import { SerializedSchema } from ".";

/**
 * The variant of a discriminated union that a value takes, by its tag.
 *
 * A discriminated union is a fork rather than a level: the variant IS the node,
 * and everything a caller wants to know about that node — its fields, its
 * `locale` field, the schema to draw it with — is on the variant and not on the
 * union. Resolving it takes the source, so it cannot be done from the schema
 * alone, which is why every caller that has only the union ends up needing this.
 *
 * `undefined` where the tag matches nothing, rather than a fallback to the first
 * variant: a value whose tag names no variant is not a member of the union,
 * validation is already saying so, and reading fields out of the wrong shape
 * would answer confidently and wrongly.
 *
 * `s.enum()` never reaches here — it is a leaf whose values are strings, with no
 * variants to resolve — so anything that is not a discriminated union answers
 * `undefined` too.
 */
export function discriminatedUnionBranchOf(
  schema: SerializedSchema | undefined,
  tag: unknown,
): SerializedSchema | undefined {
  if (schema?.type !== "discriminated-union") {
    return undefined;
  }
  for (const item of schema.items) {
    const discriminator = item.items[schema.key];
    if (discriminator?.type === "literal" && discriminator.value === tag) {
      return item;
    }
  }
  return undefined;
}
