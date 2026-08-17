---
"@valbuild/ui": minor
"@valbuild/shared": minor
"@valbuild/server": minor
---

Add staging and unstaging of pending changes, so one person can publish a small fix without shipping somebody else's unfinished work.

A **patch group** is the set of patches one user has chosen to publish. It is not a patch _set_: a patch set is computed from the schema and says which patches must move together, while a patch group is curated and says which ones you want live. A group holds every pending patch by default, so with staging untouched Publish behaves exactly as it did before — staging is opt-in. Independence comes from unstaging: hold a change back and it leaves both your preview and your publish, while still existing for everyone else.

The rule relating the two is that for every group and every patch set, the group's members within that patch set must form a prefix in patch-chain order. Staging a change therefore pulls in whatever preceded it in the same patch set; unstaging drops whatever was built on top of it. The compare view names what a toggle moves, and whose it is, rather than quietly enlarging or shrinking a publish.

Holding a region back makes it read-only until it is staged again. That is not a limitation to work around but the fix for a real defect: an author picks an array index while looking at their own view, so if the closure re-staged patches afterwards it would shift the content under the path they had just chosen and their edit would land on the wrong element — cleanly, with every invariant intact and only the content wrong.

Also fixes a pre-existing bug in patch set grouping: patch set paths were compared with a raw string prefix test, and nothing terminates a path segment, so `?foobar/title` matched `?foo`. Deleting record key `foo` and retitling record key `foobar` were treated as one inseparable change. Previously that over-grouped two unrelated edits in the review screen; with staging it would have meant publishing a deletion nobody asked for.

The `/patches` routes gain optional patch group fields, `/stat` gains a `patchGroupsSha` so a stage or unstage in one tab reaches another, and `/patch-groups/~/patches` is new. Everything is additive, so an older client or a content API without patch group support keeps working unchanged. Filesystem mode keeps the group in the client, since it has a single author and already sends an explicit patch id list when publishing.
