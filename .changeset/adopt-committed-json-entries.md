---
"@valbuild/server": patch
---

Serve the `.jsonValues()` entry content a save has just written

A `.jsonValues()` entry's committed content is resolved through the marker's own
`import()` thunk, which resolves from the module registry rather than from disk.
So after `/save` rewrote a `*.val.json`, the server kept answering with the
content from before the publish — and unlike a module source there was nothing to
re-extract, because the memoised source never held the entry content in the first
place. It only corrected itself when the host rebuilt its module graph.

Both readers saw it: a page rendering draft content, once the publish removed the
patches there was nothing left to replay over the stale baseline; and the Studio,
which reads `/json` with `apply_patches: false` on purpose because it applies
patches itself.

`prepare` already computes the new content but discarded it — the flush turns it
into a flat path-keyed file map, and the entry key is not recoverable from a path
(a marker does not carry its path at read time, and two different producers turn a
key into a path). So it now reports `PreparedCommit.patchedJsonEntries`, keyed by
module and entry key, recorded at each of the six op sites where the key is in
scope. `adoptCommittedSources` takes the prepared commit and holds it;
`getJsonEntries` consults it before the thunk, as the committed baseline, so
pending patches still replay on top unchanged.

Adopted only for a module whose source was also adopted, since the source is what
decides which keys exist.
