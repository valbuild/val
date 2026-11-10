import type { SerializedSchema } from "@valbuild/core";
import { isPageModule } from "../../utils/pageRoutes";
import type { SketchBlockType } from "./boxNodeView";

/**
 * The kinds of section the site's pages can have: the variants of every
 * list of sections in a page's schema -- an array of a discriminated union,
 * `s.array(s.discriminatedUnion("type", hero, pricing, ...))` -- named by
 * their tag. A box of one of these kinds can be built from content; any
 * other kind needs code first.
 *
 * Only a LIST of variants counts. A union on its own (a link that is
 * internal or external) is a choice inside a section, not a section, and
 * offering "external" as a kind of block would be noise.
 */
export function blockTypesOfSchemas(
  schemas: Readonly<Record<string, SerializedSchema>>,
): SketchBlockType[] {
  const found = new Map<string, SketchBlockType>();
  const walk = (schema: SerializedSchema, depth: number) => {
    // Schemas are trees, but a deep one is not a page's sections.
    if (depth > 12) {
      return;
    }
    switch (schema.type) {
      case "object":
        Object.values(schema.items).forEach((item) => walk(item, depth + 1));
        return;
      case "record":
        walk(schema.item, depth + 1);
        return;
      case "array":
        if (schema.item.type === "discriminated-union") {
          const union = schema.item;
          for (const variant of union.items) {
            const tag = variant.items[union.key];
            if (tag?.type === "literal" && typeof tag.value === "string") {
              const kind = tag.value.trim().replace(/\s+/g, "-");
              if (kind !== "" && !found.has(kind)) {
                found.set(kind, {
                  kind,
                  ...(variant.description
                    ? { description: variant.description }
                    : {}),
                });
              }
            }
          }
        }
        walk(schema.item, depth + 1);
        return;
      case "discriminated-union":
        schema.items.forEach((variant) => walk(variant, depth + 1));
        return;
      default:
        return;
    }
  };
  for (const schema of Object.values(schemas)) {
    if (isPageModule(schema)) {
      walk(schema, 0);
    }
  }
  return Array.from(found.values());
}
