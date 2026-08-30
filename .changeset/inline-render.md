---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

Explicit inline rendering: `.render({ as: "inline" })` on every field

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
