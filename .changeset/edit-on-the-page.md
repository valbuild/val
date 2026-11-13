---
"@valbuild/ui": patch
"@valbuild/shared": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

**Edit on the page (beta).** Text can now be edited where it is, in the Studio's preview, instead of in the column beside it. Turn it on under Account → Workspace → **Edit on the page**; it is off by default and remembered per browser.

With it on and Select pressed, a click on a text in the preview puts the caret in that text:

- **Strings** — a headline, a label, a link's words. Enter ends the edit (in a `.multiline()` string it is a new line), Esc ends it too.
- **Richtext** rendered with `ValRichText` — type and delete anywhere, Enter splits a paragraph, heading or list item, Backspace and Delete join them. The bold, italic, links and images that are there are kept. New formatting, links and images are still added in the Studio's own editor.

Everything else works as before: a field that is not a text (an image, a number, a date), a text the page shows as part of something larger (inside a sentence, in an `alt` or `href`), a richtext rendered with a `transform` that changes its structure, and a `readonly` field all open in the column when clicked.

Update `@valbuild/next` or `@valbuild/tanstack` together with the Studio to use it. A site on an older version is unaffected: the setting is there, and every click opens the field in the column.
