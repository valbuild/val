---
"@valbuild/shared": patch
"@valbuild/ui": patch
---

A proposal's typecheck (an upgrade, or a proposal with dependencies of its own) now checks the proposal first, and checks the site as it is only when the proposal has type errors, to tell the errors the site already had from the ones the proposal adds. A proposal that typechecks cleanly is done in one check instead of two, which is most of them. A site with no lockfile on record no longer has one worked out for it unless the second check needs it.
