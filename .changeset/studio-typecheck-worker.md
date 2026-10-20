---
"@valbuild/ui": patch
---

The unlinked `/val/adept` page can now typecheck the live site against the
lockfile it computed, in the browser. It works out the `node_modules` that
`pnpm install` would make from the lockfile alone, fetches the type
declarations of the packages the site's imports reach, and checks every
`tsconfig.json` with the project's own TypeScript (a 6.x when the project uses
TypeScript 7, which has no compiler that runs in a browser). It shows the
errors by file and how long the layout, the types and the check took.
Packages whose types could not be fetched are listed, since errors that
involve them may be wrong, with Try again when that can help.

This is the check the Upgrade button will run before it offers to merge an
upgrade; nothing else in the Studio uses it yet.
