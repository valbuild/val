---
"@valbuild/ui": patch
---

Rename a page from the Pages panel

The site map's per-row Duplicate button is now a **…** menu with two items:
**Duplicate**, unchanged, and **Rename** — which changes the page's URL and
rewrites every field that pointed at the old one, so nothing is left linking to
a URL that no longer exists.

Renaming asks the same question duplicating does — which URL — so it opens the
same form, prefilled with the page's own URL and refusing both the URL it
already has and one another page has taken.

Both entry points to a rename (a row here, and the **Change URL** control on
the page's own toolbar) now go through one implementation, so they cannot come
to disagree about what renaming a page means.
