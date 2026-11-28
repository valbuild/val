---
"@valbuild/tanstack": patch
"@valbuild/next": patch
---

A page rendered from a server draft (`<ValProvider draft={...}>`) can be edited on the page again. Its text was rendered with Val's edit tags but never marked as editable, so Select & edit found nothing to edit, and the Studio could not point at the page's text.
