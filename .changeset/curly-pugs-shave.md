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
`maxWidth`/`maxHeight` to `2560`; `encode: false` turns it off again where a
gallery turned it on, and a field backed by a gallery inherits the gallery's
setting the way it already inherits `accept` and `directory`. `type` is required
so that adding another format later does not disturb schemas written today.

Conversion is skipped — and the original bytes uploaded — whenever it would lose
something: SVG, GIF and AVIF sources, a WebP that already fits, a result larger
than the original (unless the image was downscaled), or a schema whose `accept`
would not take a WebP. Images are decoded with `imageOrientation: "from-image"`
so EXIF rotation is applied rather than lost.

Image attachments in the AI chat are unaffected: they are posted to the content
service for the model to read and never become a patch.

**Breaking (types only):** `ext` and `prefix` are removed from `ImageOptions`.
Neither was ever read by anything, but `ext` read like a way to choose the output
format, which `encode` now genuinely is. If you set `ext` on a schema whose files
are stored remotely, those refs will re-validate once.
