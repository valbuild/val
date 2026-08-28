---
"@valbuild/core": minor
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

**Breaking:** `.render({ as: "list" })` is now `.preview()`

`render` was two unrelated things. On `array` and `record` it took a `select`
closure over source and produced the rows the Studio shows for a container's
items — dynamic, expensive, and computed on demand for the paths that are on
screen. On `string` it was a static layout hint with no closure and no dependency
on source at all. They shared a name, a type, a pipeline, a store and a wire
field, and the only thing they had in common was the word.

They are now two concepts. A **preview** is what a container shows for its items;
a **render** is how one field is laid out.

```diff
- s.array(s.object({ title: s.string() })).render({
-   as: "list",
-   select: ({ val }) => ({ title: val.title }),
- })
+ s.array(s.object({ title: s.string() })).preview(({ val }) => ({
+   title: val.title,
+ }))

- s.record(item).render({ as: "list", select: ({ key, val }) => ({ /* ... */ }) })
+ s.record(item).preview(({ key, val }) => ({ /* ... */ }))
```

`s.string().render({ as: "textarea" })` and `.render({ as: "code", language })`
are unchanged.

The `as: "list"` wrapper is gone: `list` was the only value, and how a preview is
laid out is the editor's business, not the schema's. Preview data no longer
carries `layout` either — `parent: "array" | "record"` was already the
discriminant every consumer read.

A string's render now lives in the SERIALIZED schema (`render?: { as: "textarea"
} | { as: "code", language }` instead of `render?: true`), so the editor reads it
straight off the schema it already has: no store, no host round-trip, and a
module whose only render is a string layout hint is no longer sent to the host at
all. This assumes a render stays static — deliberately, for simplicity. If one
ever needs to depend on source it gets its own pipeline back rather than being
re-merged with previews; `packages/core/src/render.ts` says so.

Renamed, for consumers of the internals: `ReifiedRender` → `ReifiedPreview`,
`ListArrayRender` / `ListRecordRender` → `ArrayPreview` / `RecordPreview`,
`RenderScope` / `renderScope` → `PreviewScope` / `previewScope`. `CodeLanguage`
is unchanged, and `CODE_LANGUAGES` is now exported as the list it is derived
from.

**Wire change:** `PUT /sources/~` returns `preview` per module where it returned
`render`. It only ever carried container previews; a string's render now arrives
with the schema instead.
