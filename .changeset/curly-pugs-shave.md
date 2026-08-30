---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

Re-encode image uploads to WebP in the browser, opt-in per schema

`s.image({ encode: { type: "webp" } })` and `s.images({ encode })` convert an
upload to WebP and cap its dimensions in the browser, before it is uploaded, so
the bytes that land in `/public` are already the bytes you want to serve. A
1200×900 PNG in our fixtures goes from 155 KB to 12 KB, or 3 KB once downscaled.

Off unless a schema asks for it. `quality` defaults to `0.8` and
`maxWidth`/`maxHeight` to `2560`. A field backed by a gallery inherits the
gallery's setting the way it already inherits `accept` and `directory`, and
`s.image(gallery, { encode: false })` is how such a field opts back out — the
gallery overload takes a second argument for exactly that, since `directory` and
`accept` still belong to the gallery alone. `type` is required so that adding
another format later does not disturb schemas written today. A `quality` outside
0–1, or a `maxWidth`/`maxHeight` that is not a positive number, falls back to
the default rather than silently disabling the conversion it was asking for.

Conversion is skipped — and the original bytes uploaded — whenever it would lose
something: SVG, GIF and AVIF sources, a WebP that already fits, a result larger
than the original (unless the image was downscaled), or a schema whose `accept`
would not take a WebP. Images are decoded with `imageOrientation: "from-image"`
so EXIF rotation is applied rather than lost.

Image attachments in the AI chat are unaffected: they are posted to the content
service for the model to read and never become a patch.

**Breaking:** `ext` and `prefix` are removed from `ImageOptions`. Neither was
ever read by anything, but `ext` read like a way to choose the output format,
which `encode` now genuinely is. For most projects this is a types-only change.
It is not only types if you actually set either one: both were serialized whole
into `schema.options`, and the old validation basis hashed every option, so a
schema that set `ext` **or** `prefix` and stores its files remotely will see
those remote refs revalidate once.
