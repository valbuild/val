---
"@valbuild/core": minor
"@valbuild/ui": minor
---

New: `s.font(fontsVal)`, a field that picks a font from an `s.fontset()`.

```ts
s.object({
  headingFont: s.font(fontsVal),
  title: s.string(),
});
```

It stores `{ path }` like `s.file(fontsVal)` does, and refuses a module that is not a font set. In the Studio, a font field is shown among its object's other fields as a small row — the letter "A" set in the chosen font, and the font's file name. Click it to open the field, which shows every font in the set to pick from, an upload button, and a full specimen of the chosen font. This applies to `s.file()` fields that point at a font set too.
