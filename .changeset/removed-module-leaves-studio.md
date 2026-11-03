---
"@valbuild/ui": patch
---

A module removed from `val.modules` now disappears from the Studio straight
away, with its content, validation errors and previews. It used to stay until
the page was reloaded. Unpublished changes to it are kept and listed as changes
to a module the project no longer has, so they can still be discarded.
