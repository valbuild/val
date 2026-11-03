---
"@valbuild/server": minor
"@valbuild/shared": patch
"@valbuild/react": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
"@valbuild/mcp": patch
---

**Draft pages read what was edited, not the whole site.** A page in draft
mode used to make Val's server read every module, apply every pending
change, and preview and validate the whole project on every request -- and
then ask again for each `.jsonValues()` entry it showed. Now there is one
copy of the draft per process, made once per change and shared by every
editor and every request:

- A module nobody edited costs nothing: the page reads its own build, as a
  visitor's does.
- A request asks one cheap question -- has anything changed? -- once, and
  the draft is only re-read when it has. An edit is applied once, to the
  version before it, however many pages read it afterwards.
- `fetchVal`, `fetchValKey`, `fetchValRoute`, `fetchValRouteUrl` and
  `fetchValDraft` (Next.js and TanStack Start alike) and Val's API routes
  read that one copy, so a save through the API is seen by every reader at
  once. Before, each kept its own, and a publish moved only the copy of the
  server that handled it: in a host that keeps its content in memory, a
  draft page read through `fetchValKey` or `fetchValRoute` went on showing
  the content from before the publish.
- The MCP tools (`initValMcp`) read the same copy in local development and
  on Val's hosting, where Val's options come from your config and the
  environment. `initValMcp` takes no patch store or source files of its
  own, so in a host that keeps its content in memory it keeps a copy of its
  own, as before.
- If `initValServer` and `initValContent` (or `initValRsc`) are given
  different options for the same `val.modules` (a different patch store,
  say), they keep separate copies, and Val logs a warning saying which
  options differ.

On a site of 20 MB of content a draft read went from about half a second per
request to well under a millisecond once the draft is in memory, and the
memory it holds grows with what was edited rather than with the size of the
site. Hosted sites in proxy mode ask the content service one small question
per request instead of reading every pending change; with a content service
that predates it, Val reads the pending changes as before.

`ValDraft` (what `fetchValDraft` returns and `<ValProvider draft>` takes)
has a new optional `versions` field, filled in by the server: the page uses
it to tell that what the Studio sends is what it already shows, without
comparing the content. Nothing to change in your app.

**Changed:** `PUT /api/val/sources/~` no longer computes previews or
validates the content (the Studio does both itself, and `/api/val/validate`
checks a module on request); its `validate_sources` and
`validate_binary_files` flags are accepted and ignored.

**Deprecated, and removed in the next release.** These stay for one release
only so that a Studio, a page or a server of the previous release keeps
working while a deploy rolls out. Nothing in this release uses them; if
your own code calls any of them, move off it now:

- `PUT /api/val/sources/~`, the whole route. This release's Studio reads
  `GET /api/val/manifest` and `GET /api/val/modules/~<path>`, and the draft
  readers and MCP read in-process.
- The `source` field of the overlay's `source-update` event and the canvas's
  `sourceUpdate` message, and a page's support for an event that carries
  only `source` (this release sends `read` beside it).
- `ValDraft.base`: not sent and not read; the type stays one release so
  code written against the previous one still compiles.
- `/api/val/stat`'s `sourcesSha` and `schemaSha`: the next release's Studio
  stops depending on them, and the release after it stops sending them.
