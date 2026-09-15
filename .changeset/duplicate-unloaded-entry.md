---
"@valbuild/ui": patch
---

Duplicating a page whose content had not loaded no longer produces an empty copy

A record declared with `.jsonValues()` loads its entries on demand, and an entry
nobody has opened yet is a placeholder rather than content. Duplicating one
copied the placeholder: the copy appeared in the site map, opened on nothing,
and there was no sign that anything had gone wrong.

The content is loaded first — which the duplicate already did, but it could not
tell a load that finished from one that failed, and a fetch that fails once is
skipped by every later load. It is now asked for again, and a duplicate whose
content genuinely cannot be loaded says so instead of writing an empty copy.

Renaming got this fix in the previous release; both now share one
implementation.
