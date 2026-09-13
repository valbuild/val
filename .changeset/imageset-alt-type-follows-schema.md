---
"@valbuild/core": minor
---

`s.imageset({ alt })` now types an entry's `alt` from the `alt` schema, instead
of always calling it `string | null`.

That single hard-coded type made the locale-record form **unusable** and the
required form **unsound**, in opposite directions:

```ts
// Before: documented, but the source could not be typed.
//   Type '{ en: string; no: string; }' is not assignable to type 'string'
s.imageset({ dir: "/public/val/img", alt: s.record(s.string()) });

// Before: this compiled, then failed validation with
//   Expected 'string', got 'null'
s.imageset({ dir: "/public/val/img", alt: s.string() });
// → { width, height, mimeType, alt: null }
```

Both now behave as the schema says: a locale record types as
`Record<string, string>`, a required alt as `string`, and an omitted or
`.nullable()` alt as `string | null` exactly as before.

`ImagesetEntryMetadata` takes an optional alt parameter and defaults to
`string | null`, so existing references keep working unchanged. Where a gallery
of any alt shape is acceptable — `s.image(galleryModule)` is the one that
matters, since a field carries its own alt and never reads the gallery's — write
`ImagesetEntryMetadata<AltSource>`.

The one thing to know if you had worked around this: an explicit
`Record<string, ImagesetEntryMetadata>` annotation on the source of a
**required**-alt gallery is now too wide and will not compile. Name the alt type
(`ImagesetEntryMetadata<string>`), or drop the annotation and let the schema
type it.
