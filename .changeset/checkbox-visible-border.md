---
"@valbuild/ui": patch
---

Checkboxes in Val Studio are now visible before you tick them.

Every checkbox — the auto-save toggle, boolean fields, the change selector in
the publish dialog — drew its border in a colour that never existed. It named
`--primary-foreground`, a leftover shadcn token declared only under `:root` and
`.dark`, and the Studio renders inside a shadow root where neither selector
matches. So the border fell back to whatever colour the text beside it happened
to be, and on a pale surface the box could not be found at all until it was
ticked.

Checked and indeterminate now fill, rather than differing from unchecked only
by a small tick, and a checkbox that starts checked without being controlled
(`defaultChecked`) draws its tick instead of rendering empty.
