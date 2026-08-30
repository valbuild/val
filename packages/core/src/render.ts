import type { SerializedSchema } from "./schema";

/**
 * A RENDER is how the FIELD ITSELF is laid out in the editor, and it applies
 * only when you are looking at the field: `s.string().render({ as: "textarea"
 * })`, `.render({ as: "code", language })`, `.render({ as: "inline" })` on an
 * array/record item.
 *
 * A PREVIEW (`preview.ts`) is the other thing: how the VALUE is shown wherever
 * a preview of it is needed — a list row, a reference dropdown, a search hit —
 * that is, wherever the value is navigable to rather than open. The two never
 * intersect: a schema can carry both, a `render` is read where the field is
 * edited and a `preview` where the value is previewed. A second `.render(...)`
 * on the same schema REPLACES the first (last one wins), exactly like a second
 * `.preview(...)` replaces the first — they do not merge.
 *
 * A render is static configuration - plain data, with no closure behind it and
 * no dependency on source - which is why it lives in the SERIALIZED schema
 * (`SerializedStringSchema.render`) and is read straight off it where the field
 * is drawn. There is no render pipeline, no store and no host round-trip.
 *
 * That "static" is an ASSUMPTION we are taking deliberately, for simplicity,
 * not a law. A future render could plausibly want to depend on source - a
 * layout that varies with the value, a callback of its own. If that day comes,
 * the shape it needs back is `executePreview`'s, and the honest move is to give
 * `render` its own execute/store pair again. It is NOT to re-merge the two:
 * conflating them is what this file was split up to undo.
 */
/**
 * The list is the declaration and {@link CodeLanguage} is derived from it, so
 * that a validator elsewhere (`shared`'s zod schema) can enumerate the same
 * languages without a second copy that drifts. Same shape as `COLOR_FORMATS`.
 */
export const CODE_LANGUAGES = [
  "typescript",
  "javascript",
  "javascriptreact",
  "typescriptreact",
  "json",
  "java",
  "html",
  "css",
  "xml",
  "markdown",
  "sql",
  "python",
  "rust",
  "php",
  "go",
  "cpp",
  "sass",
  "vue",
  "angular",
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/**
 * `{ as: "inline" }` on a field that is the ITEM of an array or record: the
 * container renders the field itself inside each (sortable) row, instead of a
 * clickable preview row that navigates to it. This is what a page-builder list
 * is made of: `s.array(s.object({...}).render({ as: "inline" }))`.
 *
 * On a field that is not directly under an array or record it is inert — an
 * object's fields are already laid out in place.
 *
 * Like every render it is static configuration (see the top of this file): it
 * travels whole in the serialized schema and the editor reads it straight off
 * the item schema it already has.
 */
export type InlineRender = { as: "inline" };

/**
 * What `.render(...)` takes on every field except `s.string()`, and what the
 * serialized schema carries verbatim.
 */
export type FieldRender = InlineRender;

/**
 * What `s.string().render(...)` takes, and what the serialized schema carries
 * verbatim. A string has editor layouts of its own (textarea, code) in
 * addition to the container-facing `inline`.
 */
export type StringRender =
  | { as: "textarea" }
  | { as: "code"; language: CodeLanguage }
  | InlineRender;

/**
 * Is this item schema edited INSIDE its list row, rather than behind a
 * clickable preview row that navigates to it?
 *
 * The one answer, so that the list rows, the nav-stop rule (`getNavPath`) and
 * the add buttons cannot drift apart — they are three readings of the same
 * question, and a disagreement between them is a row you can edit in place but
 * that "add" navigates away from.
 *
 * A tagged union counts as inline when the union itself declares it OR when
 * ANY of its variants does. A page-builder list is `s.array(s.union("type",
 * block, block, ...))` and the natural place to write the render is on the
 * blocks, one per block type — the union is a dispatch, not something the
 * author thinks of as the field. `some` rather than `every` because the row
 * draws the union's own editor (the tag selector plus the matched variant's
 * fields), which handles every variant either way: with `every`, adding one
 * variant and forgetting its `.render` would silently turn the whole list back
 * into preview rows.
 *
 * This is the ONLY place a render is allowed to be read from anywhere but the
 * schema it was declared on. It stays static (see the top of this file): the
 * answer is a function of the serialized schema alone, never of the value the
 * row happens to hold.
 */
export function isInlineRender(schema: SerializedSchema): boolean {
  if (schema.render?.as === "inline") {
    return true;
  }
  if (schema.type === "union") {
    return schema.items.some((item) => item.render?.as === "inline");
  }
  return false;
}
