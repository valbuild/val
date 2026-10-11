# Render and preview

Two schema methods decide how content looks in the Studio, and they answer
different questions. Conflating them is the mistake this note exists to
prevent — it has already been undone once, when the two shared a pipeline.

## The rule

- **`render` is how a field is laid out, and applies only when you are looking
  at the field.** `.render({ as: "inline" })` on an ARRAY or RECORD edits each
  of its items inside its (sortable) list row instead of behind a clickable
  row. The list decides; the item has no say. That is the whole of what a
  render says — see "What a render is not" below. (`s.keyOf(...)` also takes
  one, meaning something of its own: see "Where it is declared".)
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

## What a render is not

A render used to be the answer to "how is a string edited" as well: there were
`{ as: "textarea" }` and `{ as: "code", language }` variants on `s.string()`
alongside `inline`. Both are gone.

```ts
s.string().multiline(); // was .render({ as: "textarea" })
s.code({ language: "typescript" }); // was .render({ as: "code", language })
```

The reason is that neither was about layout. Whether a string may hold line
breaks is a fact about the content, and it belongs to the schema: it is
`.multiline()`, a property the serialized schema carries next to `render`
(`SerializedStringSchema.multiline`) and read the same synchronous way where the
field is drawn. Code is a step further — it is its own schema type, `s.code()`,
because a language is not a way of drawing a string but part of what the value
is, and being a type is what lets it opt out of stega encoding: invisible
characters woven into source code are corruption, not an edit tag
(`stegaEncode`'s `isCodeSchema`).

What is left is one question — does this list edit its items in their rows —
which is why `FieldRender` is a single variant and `isInlineRender` can answer
it from the serialized schema alone. A render that could also mean "textarea" was a
union whose only common trait was that it lived in the same field.

## Where they meet: a list row, and the render wins

A list row is the one place both have a claim, because a row is where a value
is normally shown rather than opened. The rule is that **`inline` wins
outright**:

```ts
s.array(s.object({ ... }).preview(previewFun)).render({ as: "inline" });
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

`ArrayFields` reads this off the array's own schema and picks the list: an
inline array gets `BlockList` (dense rows, each an editor, collapsible, nested
lists behind a rail) and everything else gets `SortableList` (preview rows you
click through to). `RecordFields` asks the same question of the record, and
lays its entries out in place — under their keys, since a record's rows are
labelled by key and have no order to drag.

### The container declares it, never the item

`isInlineRender` (`core/src/render.ts`) is the one implementation of the
question, and it takes the CONTAINER: it is true for an array or record that
declares `.render({ as: "inline" })`, and false for anything else.

```ts
s.array(
  s.discriminatedUnion(
    "type",
    s.object({ type: s.literal("text"), text: s.richtext() }),
    s.object({ type: s.literal("code"), code: s.string() }),
  ),
).render({ as: "inline" });
```

That is how a page-builder list is written. It used to be the other way round
— the render went on the ITEM — and three things were wrong with that, all of
them gone now:

- **A union had nowhere natural to put it.** The union is a dispatch, not
  something an author thinks of as the field, so the render went on the blocks,
  and `isInlineRender` had to look through the union and accept ANY variant's
  render. One block type declaring it decided the whole list.
- **An item could not be reused** in one list that wants forms and another
  that wants preview rows, since the layout was baked into the item.
- **A schema that was not an item carried a setting that did nothing**, on
  every one of the eighteen schema types.

It reaches ONE level down. In
`s.array(s.object({ tags: s.array(s.string()) })).render({ as: "inline" })`
the objects are inline and `tags` keeps its own default — a nested list says
so for itself.

The nav-stop rule (`getNavPath`) asks it of the PARENT: an item of an inline
list is not a place navigation can stop, because the list has no row to
navigate from. The add buttons ask it of the list they add to. All three read
the same function, so a row you edit in place cannot have an "add" that
navigates away from it.

`s.router(...)`, `s.imageset(...)` and `s.fileset(...)` are records, and refuse
a render at definition time: pages and media have UIs of their own that a
render would not reach, and an accepted-but-ignored setting is worse than an
error.

`s.keyOf(...)` takes a render too, and it means something else: the selected
entry's CONTENT is shown below the selector. That is the reference field's own
layout, not a list's, so `isInlineRender` answers `false` for it.

It stays static: the answer is a function of the serialized schema alone,
never of the value a row happens to hold.

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
in `core/src/schema/index.ts`). A discriminated union without a preview of its own
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
they meet" above), so a preview on the item of an inline list buys a title to
collapse to rather than a card.

`PreviewItem.image` has three states and they are all load-bearing: an
`ImageSource` draws the thumbnail, `null` means the preview declares an image
this particular value does not have (the column is still reserved, so rows in
a list stay aligned), and `undefined` means no image is declared at all (no
column). Coalescing `null` and `undefined` is what left mixed lists ragged.
