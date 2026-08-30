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
  a list row you click through to, a reference (`keyOf`) dropdown, a search
  hit, the references view. A preview is needed exactly where the value is
  NAVIGABLE to rather than open. It is never how the field itself is edited —
  and where the two meet, on a row that is inline, the render wins (below).

So the two never intersect: a schema can carry both, `render` is read where
the field is drawn, `preview` where the value is previewed. Declaring another
`.render(...)` on the same schema REPLACES the earlier one (last wins), and a
second `.preview(...)` replaces the earlier preview the same way — they do not
merge.

## Where they meet: a list row, and the render wins

A list row is the one place both have a claim, because a row is where a value
is normally shown rather than opened. The rule is that **`inline` wins
outright**:

```ts
s.array(s.object({ ... }).render({ as: "inline" }).preview(previewFun));
```

Looking at that array field, you see the object's own fields, laid out in the
row and editable there. You do NOT see `previewFun`'s card. The render is the
author saying "this is edited here", which settles what the field is; the
preview then describes the value everywhere it is only referred TO — a search
hit, a `keyOf` dropdown, the references view, a row in some OTHER list that
holds this value — and, inside its own row, the collapsible header that says
what the block is while its fields are folded away. That header is a summary of
the value, which is exactly a preview's job; it is not how the row is edited.

Nothing about the preview is wasted by inlining, in other words: it is still
the answer to "what is this value called", it is just no longer asked "how is
this value edited".

`ArrayFields` reads this off the item schema and picks the list: an inline item
gets `BlockList` (dense rows, each an editor, collapsible, nested lists behind a
rail) and everything else gets `SortableList` (preview rows you click through
to). `RecordFields` asks the same question of its entries, and lays an inline
one out in place — under its key, since a record's rows are labelled by key and
have no order to drag.

### On a union, the variants may declare it

`isInlineRender` (`core/src/render.ts`) is the one implementation of the
question, and it delegates through a tagged union: the union is inline when the
union itself declares it, or when ANY of its variants does.

```ts
s.array(
  s.union(
    "type",
    s
      .object({ type: s.literal("text"), text: s.richtext() })
      .render({ as: "inline" }),
    s
      .object({ type: s.literal("code"), code: s.string() })
      .render({ as: "inline" }),
  ),
);
```

That is how a page-builder list is written — the render belongs on the blocks,
one per block type, because the union is a dispatch rather than something the
author thinks of as the field. Read strictly off the array's item schema, the
answer for that shape is `false`, and the list drew preview rows: it looked
identical with the render and without it.

`some` rather than `every` because the row draws the union's own editor (the
tag selector, then the matched variant's fields), which copes with every
variant either way — so a variant added later without a render must not
silently turn the whole list back into preview rows.

This is the only place a render is read from anywhere but the schema it was
declared on, and it stays static: the answer is a function of the serialized
schema alone, never of the value a row happens to hold.

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

## What a declared preview buys, visually

A value that HAS a preview is drawn by `ListPreviewItem`: a compact media row —
thumbnail left, title and subtitle stacked beside it, one line each, truncated
rather than wrapped. It can be laid out that tightly precisely because the
preview told us what the row is made of.

A value with no preview falls back to `Preview`, which renders whatever the
value happens to be, per type. `RefPreview` picks between the two, and pads
both the same so a list does not change density row by row depending on which
branch each row took — callers must not add their own padding on top.

Neither of those is what an INLINE row draws: an inline row draws the field.
The preview reaches it only as the one line of text in its header (see "Where
they meet" above), so a preview declared next to an inline render buys a title
to collapse to rather than a card.

`PreviewItem.image` has three states and they are all load-bearing: an
`ImageSource` draws the thumbnail, `null` means the preview declares an image
this particular value does not have (the column is still reserved, so rows in
a list stay aligned), and `undefined` means no image is declared at all (no
column). Coalescing `null` and `undefined` is what left mixed lists ragged.
