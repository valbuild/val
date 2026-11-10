---
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/react": minor
"@valbuild/next": minor
"@valbuild/tanstack": minor
"@valbuild/ui": minor
---

Removed what 0.151.0 kept only so that a Studio, a page and a server from the release before could still talk to each other during a deploy:

- **`PUT /api/val/sources/~`** is gone. Nothing in 0.151.0 asked it: the Studio reads modules through `GET /api/val/manifest` and `GET /api/val/modules/~<path>`, and `fetchVal`, `useVal` and the MCP tools read the server's content in-process. If a script or test of yours read content through it, read one module with `GET /api/val/modules/~<path>` instead. Its answer has the module's `source` and `version`, and an `entries` map holding the `.jsonValues()` entries pending changes touched.
- **`ValDraft.base`** is gone from the type. It has not been sent or read since 0.151.0, so a `draft` you pass to `ValProvider` is not affected.
- **A page no longer accepts edits relayed by a Studio from before 0.151.0.** Such a Studio sent each module as a bare `source`. After the upgrade, the Studio and your pages come from the same deploy, so this only matters while an older Studio is still open in a tab during a rollout. Reloading that tab fixes it.
- **`/api/val/stat`** no longer needs `sourcesSha` and `schemaSha`. The Studio now tells your local server which version it last saw, and the server still sends both fields for a Studio of 0.151.0. They stop being sent in the next release.
