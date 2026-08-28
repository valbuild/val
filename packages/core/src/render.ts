/**
 * A RENDER is how one field is laid out in the editor: `s.string().render({ as:
 * "textarea" })`, `.render({ as: "code", language })`.
 *
 * It is static configuration - plain data, with no closure behind it and no
 * dependency on source - which is why it lives in the SERIALIZED schema
 * (`SerializedStringSchema.render`) and is read straight off it where the field
 * is drawn. There is no render pipeline, no store and no host round-trip.
 *
 * That "static" is an ASSUMPTION we are taking deliberately, for simplicity,
 * not a law. A future render could plausibly want to depend on source - a
 * layout that varies with the value, a callback of its own. If that day comes,
 * the shape it needs back is `executePreview`'s, and the honest move is to give
 * `render` its own execute/store pair again. It is NOT to re-merge the two:
 * conflating them is what this file was split up to undo.
 *
 * The dynamic, source-dependent, demand-scoped thing - what a container shows
 * for its items - is a PREVIEW. See `preview.ts`.
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
 * What `s.string().render(...)` takes, and what the serialized schema carries
 * verbatim.
 */
export type StringRender =
  | { as: "textarea" }
  | { as: "code"; language: CodeLanguage };
