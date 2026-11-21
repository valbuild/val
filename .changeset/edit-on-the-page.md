---
"@valbuild/ui": patch
"@valbuild/shared": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

**Select & edit.** Text can now be edited where it is, in the Studio's preview, instead of in the column beside it. Select has a menu beside it with two modes:

- **Select** opens the field you click in the column, as before. It is the mode Select starts in.
- **Select & edit** puts the caret in the text you click, on the page. The mode you used last is remembered per browser.

In Select & edit:

- **Strings** — a headline, a label, a link's words. Enter ends the edit (in a `.multiline()` string it is a new line), Esc ends it too.
- **Richtext** rendered with `ValRichText` — type and delete anywhere, Enter splits a paragraph, heading or list item, Backspace and Delete join them. Formatting controls float beside the text: bold, italic, strikethrough, links, headings and lists, whichever the field's schema allows. They are the same controls the field has in the column.

The caret goes in as you click, so you can start typing straight away. A text you have emptied stays on the page as a line you can click while Select is on, in either mode, so you can pick it or type in it again; with Select off the page is laid out as before.

While you type, the "On this page" column scrolls to the same field and shows it selected, with what you type appearing in it. A validation error for the field shows by the text on the page as well as in the column, and goes when you fix it. Zooming the preview, fitting it or changing its width does not end the edit: the caret stays in the text and you can keep typing. Reloading the page, changing its address or leaving the preview ends the edit, and what you typed is saved.

Everything else still opens in the column when clicked: a field that is not a text (an image, a number, a date), a text the page shows as part of something larger (inside a sentence, in an `alt` or `href`), a richtext rendered with a `transform` that changes its structure, and a `readonly` field. Images cannot be added to a richtext from the page yet.

Update `@valbuild/next` or `@valbuild/tanstack` together with the Studio to use it. A site on an older version is unaffected: in either mode, every click opens the field in the column.
