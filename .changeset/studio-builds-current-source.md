---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/tanstack": patch
"@valbuild/tanstack-build": patch
"@valbuild/ui": patch
---

A Studio publish of a project with no repository now ships every edit that was saved, and keeps the site styled.

- A host that embeds the project's source can hand it to Val as `projectSource` (`initValServer(..., { http: { projectSource } })`). A publish then patches that text, not text fetched from the content service at a commit, which a project with no repository does not have. The build platform's wiring passes the build's own source, so `.val.ts` can be rendered for a project made on `/new`. Before, its first save produced no files, and the build that followed carried none of the save's edits.
- New route `GET /api/val/built-source`: the `.val.ts` text of every module changed since the running build, with every commit since it applied. The Studio builds from it, so an edit whose own publish failed, and a Finish publishing, are no longer left out of the next build.
- A Studio build that compiles no stylesheet (a browser cannot run Tailwind `@plugin`s) keeps the live site's. A Studio save never changes a stylesheet or a component, so the live CSS is still the right one.
