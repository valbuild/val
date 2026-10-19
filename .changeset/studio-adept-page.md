---
"@valbuild/ui": patch
"@valbuild/server": patch
---

The Studio has an unlinked page, `/val/adept`, for trying out dependency
upgrades on a hosted project: it computes a lockfile for the live site's
`package.json`, previews each kind of upgrade from it, and fetches the type
declarations and TypeScript compiler a typecheck would load. It only shows
results; nothing on it is staged or published. Nothing links to it yet.
