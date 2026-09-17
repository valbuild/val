---
"@valbuild/server": patch
---

`createValApiRouter` no longer puts `fs` in every integration's module graph

`fs` and `path` were imported at module scope for `safeReadGit`, a local
development convenience that scans upwards for a `.git` to guess the commit and
branch, and whose only caller is the CLI. A static import put `fs` in the module
graph of everything reaching `createValApiRouter` — which is every server
integration, including ones that run where there is no filesystem at all.

Behaviour is unchanged where there is a filesystem.
