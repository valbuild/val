---
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

Show `.jsonValues()` entries in the history pane

A `.jsonValues()` record keeps each entry's content in its own `*.val.json`
file; the module's own content is just markers pointing at them. The history
pane had no way to fetch those files for a past commit, so every entry rendered
as an **empty field** — which reads as "the author left this blank", about
content that was simply stored somewhere else.

Entries now load in the history pane the same way they load in the Studio: one
at a time, when you open one. A commit with a thousand support pages costs
nothing until you look at one of them.

An entry that cannot be read says so instead of rendering blank — including the
case where the key did not exist yet at that commit, which is a real answer
rather than an error.
