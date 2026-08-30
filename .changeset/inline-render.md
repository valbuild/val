---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

Explicit inline rendering (`.render({ as: "inline" })`) and item-level `.preview(...)` on every field

**`.preview(...)` moved from containers to the value being previewed.** Every
schema now has `.preview(({ val }) => ({ title, subtitle?, image? }))`, and an
array/record reifies its rows by running each ITEM's closure:

```ts
const author = s
  .object({ name: s.string() })
  .preview(({ val }) => ({ title: val.name }));
const authors = s.array(author);
```

A tagged union without a preview of its own dispatches to the variant the
value takes, so blocks in a page-builder list preview per block type. `render`
and `preview` never intersect: `render` is how the FIELD is laid out when you
are looking at it, `preview` is how the VALUE shows wherever a preview is
needed (list rows, keyOf dropdowns, search, references) — see
`architecture/render-and-preview.md`. A second `.render(...)` (or
`.preview(...)`) on the same schema replaces the first.

**Breaking (preview):** a `.preview` on `s.array(...)`/`s.record(...)` now
describes the container ITSELF as a value (for when it is someone else's
item), not its rows — move the closure onto the item schema. The record
closure no longer receives `key` (derive the title from `val`). A null entry
is skipped rather than passed to the closure. `.jsonValues()` must come before
`.preview(...)`, like `.validate(...)`.

Every schema now has a `.render({ as: "inline" })` method. When the item of an
array or record carries it, the Studio edits that item IN PLACE inside the
(sortable) list row instead of showing a clickable preview row that navigates
to it — which is what a page builder is made of:

```ts
s.array(
  s.object({ title: s.string(), body: s.richtext() }).render({ as: "inline" }),
);
```

Like the existing string renders (`textarea`, `code`), it is static
configuration carried whole in the serialized schema, and it survives
serialize → deserialize and chaining (`nullable`, `readonly`, `hidden`,
`describe`, `validate`).

**Breaking (behavior):** strings in arrays are no longer inlined implicitly.
`s.array(s.string())` now renders preview rows and its items become navigation
stops, like every other item type; add `.render({ as: "inline" })` to the
string schema to get the old editing-in-the-list behavior back. The nav-stop
rule (`getNavPath`), the add-button's "navigate into new item" rule, and the
sortable list row all key on the new flag instead of `item.type === "string"`.

An inlined `s.keyOf(...)` also renders the CONTENT of the referenced entry
below the key selector (the shared entry itself — edits go to the referenced
module).

Also adds a Storybook-only prototype of a denser sortable list
(`BlockList`, working name) aimed at page-builder trees: three nested list
levels on one laptop screen, rows collapse, nested rows share their parent's
left border. Not wired into `ArrayFields` yet.
