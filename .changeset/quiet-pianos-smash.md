---
"@valbuild/tanstack-build": patch
"@valbuild/server": patch
---

`rebakeGit` rewires a project record to a different commit, and the Studio's publish proxy can now reach `/project-source`.

Both are groundwork for a publish that happens in the browser. `rebakeGit` replaces the one line in the generated `val.server.ts` that carries the commit, rather than regenerating the file: a publisher running inside the deployment does not know the project id or the platform's address, and reconstructing the file from what it could guess would throw away wiring it cannot see.
