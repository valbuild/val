---
"@valbuild/ui": patch
---

Editing one field of a gallery entry no longer groups the whole module as one change

Typing alt text on an `s.imageset()` entry logged **Could not resolve path while
creating patch set: Cannot perform op: 'add' on non-array or non-record schema.
Type: object** on every keystroke, and collapsed the entire media module into a
single patch set. Staging any one change in that module then dragged every other
change in it along — the upload, and every keystroke of every other entry's alt
text — because a patch group has to contain a prefix of each patch set it
touches.

The patches themselves were fine. `add` on an object key is create-or-set, and
the Studio writes `add` rather than `replace` on purpose so the write survives
the key having gone away in the meantime; it was the grouping that did not know
that an object is keyed. Objects are now classified like records and settings
sections: the change affects the key it names, and nothing else.

A path that genuinely no longer fits its schema — a stale patch written before
the schema changed — still falls back to grouping the whole module, which is the
conservative answer when we cannot say what a change affects.
