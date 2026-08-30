# Render and preview

Two schema methods decide how content looks in the Studio, and they answer
different questions. Conflating them is the mistake this note exists to
prevent — it has already been undone once, when the two shared a pipeline.

## The rule

- **`render` is how the FIELD ITSELF is laid out, and applies only when you
  are looking at the field.** `s.string().render({ as: "textarea" })` is a
  textarea instead of an input; `.render({ as: "code", language })` a code
  editor; `.render({ as: "inline" })` on an array/record item edits the item
  inside the (sortable) list row instead of behind a clickable row.
- **`preview` is how the VALUE is shown wherever a preview of it is needed** —
  a list row, a reference (`keyOf`) dropdown, a search hit, the references
  view. A preview is needed exactly where the value is NAVIGABLE to rather
  than open. It is never how the field itself is edited.

So the two never intersect: a schema can carry both, `render` is read where
the field is drawn, `preview` where the value is previewed. Declaring another
`.render(...)` on the same schema REPLACES the earlier one (last wins), and a
second `.preview(...)` replaces the earlier preview the same way — they do not
merge.

## Where each is declared

A `preview` is declared on the schema of the value being previewed — the
ITEM, not the container:

```ts
const author = s
  .object({ name: s.string() })
  .preview(({ val }) => ({ title: val.name }));
const authors = s.array(author);
```

The array reifies its rows by running each item's closure (`executePreviewItem`
in `core/src/schema/index.ts`). A tagged union without a preview of its own
dispatches to the variant the value takes, so page-builder blocks preview per
block type. A `.preview` on the array/record itself describes the CONTAINER as
a value, for when it is the item of something else.

## Why the plumbing differs

A `render` is static data — no closure, no source — so it travels whole in the
serialized schema and is read where the field is drawn (`core/src/render.ts`).
A `preview` is a user closure over source, so only the host can run it: the
serialized schema carries just a `preview: true` marker, and the Studio asks
the host on demand, scoped to what is on screen (`core/src/preview.ts`,
`ui/spa/stores/PreviewStore.ts`).
