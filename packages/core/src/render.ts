import type { SerializedSchema } from "./schema";

/**
 * THE RULE, and the only sentence that needs to be remembered:
 *
 *   **`.describe()` is INPUT HELP and is shown wherever that field — or a
 *   record's key — is being ENTERED; `.preview()` is a NAME and is shown
 *   wherever the value is REFERRED TO rather than edited; `.render()` is
 *   LAYOUT and applies only while the field is open in front of you.**
 *
 * The test that settles every case: **can the reader change something here?**
 * If yes it is a place for a description — the input beside a label, the key
 * box in "New entry", "Rename key", "Duplicate", "New page", the key half of a
 * reference dropdown. If no, it is a place for a preview — a list row, a
 * reference once chosen, a search hit, a sitemap row, the heading of what you
 * navigated to.
 *
 * That is why a description is plain data on the serialized schema and a
 * preview is a closure: a description is true before any value exists and says
 * the same thing to everyone filling the field in, and a preview cannot exist
 * without the one value it names. So a description must never be used as a
 * subtitle — it would repeat one sentence under every row of a list — and a
 * preview must never be used as help text, because there is nothing to preview
 * until after the value has been entered.
 *
 * None of the three substitutes for another: a field with a perfect
 * description still previews as `#3` until someone writes the preview.
 */
/**
 * A RENDER is how a field is laid out in the editor, and it applies only when
 * you are looking at the field. It is declared by a CONTAINER about its
 * children, never by a child about itself: `s.array(item).render({ as: "inline" })`
 * and `s.record(item).render({ as: "inline" })`. The one other schema that takes
 * a render is `s.keyOf(...)`, where it means something of its own (see
 * `KeyOfSchema.render`).
 *
 * Why the container: inline is a property of the LIST — "my items are edited in
 * their rows" — and the item schema is the wrong place to say it. An item can be
 * reused in a list that wants preview rows and one that wants forms; a tagged
 * union had to be declared inline on every variant (or on any one of them,
 * which was worse); and a schema that was not an item carried a setting that
 * did nothing. Putting it on the container makes all three go away.
 *
 * It is deliberately the ONE thing a render can say. What a string looks like
 * when it holds more than a line is the schema's own business — `.multiline()`
 * for a text box, `s.code({ language })` for a code editor — not a layout
 * bolted onto `s.string()` from outside.
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
 * (`SerializedArraySchema.render`) and is read straight off it where the field
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
 * `{ as: "inline" }` on an array or record: the container renders each of its
 * DIRECT items' own editor inside its (sortable) row, instead of a clickable
 * preview row that navigates to it. This is what a page-builder list is made
 * of: `s.array(s.discriminatedUnion("type", hero, text)).render({ as: "inline" })`.
 *
 * It reaches one level down and no further: in
 * `s.array(s.object({ tags: s.array(s.string()) })).render({ as: "inline" })`
 * the objects are inline and `tags` keeps its own default.
 *
 * Not available on `s.router(...)`, `s.imageset(...)` or `s.fileset(...)`:
 * pages and media have UIs of their own, and `RecordSchema.render` throws there.
 *
 * On `s.keyOf(...)` the same value means something else: the selected entry's
 * content is shown below the selector. That is the keyOf field's own layout,
 * and is not read by any list.
 */
export type InlineRender = { as: "inline" };

/**
 * What `.render(...)` takes, and what the serialized schema carries verbatim.
 */
export type FieldRender = InlineRender;

/**
 * Does this CONTAINER edit its items inside their list rows, rather than behind
 * clickable preview rows that navigate to them?
 *
 * Pass the array or record — never the item. Anything else answers `false`,
 * `s.keyOf` included: its render is about the keyOf field, not about a list.
 *
 * The one answer, so that the list rows, the nav-stop rule (`getNavPath`) and
 * the add buttons cannot drift apart — they are three readings of the same
 * question, and a disagreement between them is a row you can edit in place but
 * that "add" navigates away from.
 *
 * It stays static (see the top of this file): the answer is a function of the
 * serialized schema alone, never of the value the row happens to hold.
 */
export function isInlineRender(container: SerializedSchema): boolean {
  if (container.type !== "array" && container.type !== "record") {
    return false;
  }
  return container.render?.as === "inline";
}
