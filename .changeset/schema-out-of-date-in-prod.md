---
"@valbuild/core": patch
"@valbuild/ui": patch
---

Fix "A new version has been deployed" showing on every production load.

`schemaSha` was seeded with a hash of the whole `val.config`. The config carries
values that are not part of the schema and that differ between the server and
the browser — most notably the documented
`gitCommit: process.env.VERCEL_GIT_COMMIT_SHA` / `gitBranch`, which are
server-only env vars and therefore `undefined` in the client bundle. The editor
compares its locally extracted `schemaSha` against the server's to detect a
redeploy, so the two sides disagreed permanently and the blocking
schema-out-of-date dialog appeared on every load (reloading did not help).
`schemaSha` is now derived from the serialized schemas only.

Also fixed along the way:

- `ValSyncEngine.reset()` no longer clears its listener registry. `subscribe`
  closes over that registry, so clearing it left every mounted component
  subscribed to an object that `emit` no longer read from, and the UI silently
  stopped updating for the rest of the session.
- The first `/stat` no longer counts as a redeploy. `serverSideSchemaSha` starts
  out `null`, which always compared unequal and forced a reset plus a recursive
  re-init on every cold start.
- `extractValModules` builds `moduleErrors` with `push` instead of index
  assignment. The sparse array it produced crashed `Service.get`, which looks
  the errors up with `Array.prototype.find` (that visits holes as `undefined`).
- A val module that throws while importing is now reported as a module error
  instead of rejecting the whole extraction. A rejecting `def()` made
  `ValOps.initSources` reject, so `/stat`, `/schema` and `/sources/~` all failed
  opaquely instead of naming the module that is actually broken. Module errors
  now also say which `val.modules` entry they came from.
- `ValSyncEngine.subscribe` now removes listeners by identity on unsubscribe.
  It used to splice by an index captured at subscribe time, which drifts as soon
  as anything else in the same bucket unsubscribes first, and the array-path
  overload indexed the paths array with a listener index — so unsubscribing one
  component could remove another component's listener and leave its own behind.
