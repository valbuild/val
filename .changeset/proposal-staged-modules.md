---
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/tanstack": minor
"@valbuild/tanstack-build": minor
"@valbuild/ui": minor
---

Editing content in a proposal whose code changed, before the proposal is built again:

- **A module the proposal adds** can be edited and saved right away. Its content is read from the new file and saved. Before, those edits were dropped. If the module's content is made by code (not written out in the file), the save waits and says to build the proposal first.
- **A module whose schema moved because a file it imports changed** (for example a shared `src/schemas/*.ts`) is no longer read with the old schema. Pages keep showing the content as built until the proposal is built again.
- **Edits that no longer fit the schema** can be handed to the assistant. The banner that lists them has a **Have the assistant move it** button for each one. You still discard the held edit yourself afterwards.

For this, `@valbuild/tanstack-build` records which files each Val module imports, and the `val.server.ts` it generates passes that to Val as the new optional `moduleDependencies` option of `initValServer` and `initValContent`. You do not need to set it yourself. A site built before this has no `moduleDependencies` and works as before.
