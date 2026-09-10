---
"@valbuild/core": patch
"@valbuild/ui": patch
---

A value that has not been written yet now says so, instead of looking broken

Opening an array item or a record entry whose value is `null` rendered the item
schema's fields over nothing, so every one of them reported **Not Found** — a
column of broken fields where the truth is one fact about the value: nobody has
written it. It now shows a single "nothing here yet" state with a button that
creates it.

A field inside an object always had this — the checkbox beside its label — but
a value opened on its own has no such wrapper, and that is exactly what
navigating to an entry does. Both places now agree.

This is most visible with a record whose keys are declared by its schema
(`s.record(s.locale(), …)`, or a union of literals), where an entry nobody has
written is `null` rather than absent. There the wording follows: an unwritten
entry reads as **Not translated** in the list and **Not translated yet** in the
entry, rather than as an empty row.

Also fixed: `Internal.resolvePath` reported a record entry that exists with a
falsy value — `null`, but equally `""`, `0` and `false`, in any record — as a
key the record does not have, so nothing could resolve a path to one.
