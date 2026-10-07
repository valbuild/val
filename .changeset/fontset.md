---
"@valbuild/core": minor
"@valbuild/ui": minor
---

New: `s.fontset()`, a collection of fonts.

```ts
const fontsVal = c.define(
  "/content/fonts.val.ts",
  s.fontset({ dir: "/public/val/fonts" }),
  {},
);
// a field that picks one of them
s.object({ headingFont: s.file(fontsVal) });
```

It is an `s.fileset()` whose `accept` defaults to the web font formats (`font/woff2`, `font/woff`, `font/ttf`, `font/otf`); pass `accept: "font/woff2"` to allow only WOFF2. Fonts are not converted on upload.

The Studio now previews fonts set in themselves — in the gallery, in the picker of a field that points at a font set, and in the field — wherever a file is a font, including fonts in an ordinary `s.fileset()`.

Font uploads are typed from their bytes, so a font is stored as `font/woff2`, `font/ttf` and so on even when the browser reports no type for it. Files ending in `.ttf`, `.otf` and `.woff` now map to the `font/` types rather than the older `application/x-font-*` names, which are still accepted where they are already stored.
