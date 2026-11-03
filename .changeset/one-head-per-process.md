---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/react": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
"@valbuild/mcp": patch
---

**Draft pages read what was edited, not the whole site.** A page in draft
mode used to make Val's server read every module, apply every pending
change, and preview and validate the whole project on every request -- and
then ask again for each `.jsonValues()` entry it showed. Now the server keeps
one copy of the draft per process, made once per change and shared by every
editor and every request:

- A module nobody edited costs nothing: the page reads its own build, as a
  visitor's does.
- A request asks one cheap question -- has anything changed? -- and the
  draft is only re-read when it has. An edit is applied once, to the version
  before it, however many pages read it afterwards.
- `fetchVal`, `fetchValKey`, `fetchValRoute`, `fetchValRouteUrl` and
  `fetchValDraft` (Next.js and TanStack Start alike), Val's API routes and
  the MCP tools all read that one copy, so a save is seen by every one of
  them at once.

On a site of 20 MB of content a draft read went from about half a second per
request to well under a millisecond once the draft is in memory, and the
memory it holds grows with what was edited rather than with the size of the
site. Hosted sites in proxy mode ask the content service one small question
per read instead of reading every pending change; with a content service
that predates it, Val reads the pending changes as before.

`ValDraft` (what `fetchValDraft` returns and `<ValProvider draft>` takes)
has a new optional `versions` field, filled in by the server: the page uses
it to tell that what the Studio sends is what it already shows, without
comparing the content. Nothing to change in your app.

Behaviour that changed: `PUT /api/val/sources/~` no longer computes previews
or validates the content (the Studio does both itself, and `/api/val/validate`
checks a module on request); its `validate_sources` and
`validate_binary_files` flags are accepted and ignored.
