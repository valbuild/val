---
"@valbuild/tanstack-build": patch
"@valbuild/ui": patch
---

The Studio's in-browser builder now uses `@rolldown/browser` 1.2.12, up from 1.2.9, and `@valbuild/tanstack-build` asks for at least that version. This brings in rolldown's fixes to code splitting and deterministic chunk merging since 1.2.9.

The first publish after updating may produce a new build of your site even when no content changed, because the bundler's output can differ between versions. The native `rolldown` that builds a project's dependency layer is not affected.
