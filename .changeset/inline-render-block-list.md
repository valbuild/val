---
"@valbuild/core": minor
"@valbuild/ui": minor
---

Inline array items are edited in a block list, and inline wins over preview

An array whose ITEM schema is inline (`.render({ as: "inline" })`) now renders
as `BlockList` — the dense, collapsible, drag-sortable list built for
page-builder trees — instead of the preview rows it kept drawing. Lists whose
items are not inline are untouched.

`.render({ as: "inline" })` declared on the VARIANTS of a tagged union now
counts for the union:

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

which is how a page-builder list is written. Previously only a render on the
union itself was read, so that list looked exactly the same with the render as
without it. The new `isInlineRender(serializedSchema)` (exported from
`@valbuild/core`) is the single answer, used by the list rows, the nav-stop
rule and the add buttons alike; a union counts as inline when it declares the
render itself or when any of its variants does.

**`inline` takes precedence over `preview`.** A schema carrying both is EDITED
inline — the row is the field, not a preview card. The preview still describes
the value everywhere it is only referred to (search hits, `keyOf` dropdowns,
the references view) and now also titles the row's own collapsible header, so a
folded block still says what it is. See `architecture/render-and-preview.md`.
