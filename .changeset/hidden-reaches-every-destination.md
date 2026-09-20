---
"@valbuild/ui": patch
---

`hidden()` on a module now keeps it out of every part of the nav, not just the Explorer

`hidden()` on a module's own schema means "the nav does not list this" — a module has no parent to be hidden from, so it can mean nothing else. That rule now reaches every destination the menu has:

- **Pages** — a hidden page router contributes no rows to the sitemap.
- **Media** — a hidden `s.imageset()` / `s.fileset()` gallery is not offered.
- **Settings** — a hidden settings module is not offered.
- **Explorer** — as before.

A hidden module is still reachable and still fully editable: from an `s.view()` row, from search, or from a validation error. Only the listing changes.

One thing to be deliberate about: hiding a **page router** takes its pages out of the sitemap with it, so the site's URLs are listed nowhere in the Studio. That is the rule working as stated, but it is rarely what you want — hide the router only if the pages are reached some other way.

Two settings modules remain an error rather than becoming a way to pick between them: the settings module is resolved first and dropped afterwards if it is hidden.
