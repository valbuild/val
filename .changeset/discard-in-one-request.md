---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

Discarding many changes is now one request, and a discard that only partly succeeds no longer leaves discarded changes on screen.

When some of the changes could not be discarded, for example because one was part of a publish that was running, the Studio said nothing had been discarded and kept showing changes that were already gone. It now drops the ones that were discarded, keeps the rest, and says how many went through, with **Try again** (or **Cancel publish**) for the ones that are left. **Cancel publish** is offered again when a running publish holds a change: that refusal never reached the Studio before.

`DELETE /api/val/patches` now takes its ids in the body (`{ "ids": [...] }`), and still accepts the `id` query parameters older Studio tabs send. When it answers 500 because some changes were refused, it now also says which ones it deleted (`deleted`) and the version it moved to (`headVersion`).
