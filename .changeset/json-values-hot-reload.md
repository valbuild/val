---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

Hand-editing a `*.val.json` now reaches an open Studio, instead of requiring a page reload.

Nothing could see such an edit before: `sourcesSha` and `baseSha` hash the module source, and a `.jsonValues()` module's source is only markers — the content sits behind a lazy import that `JSON.stringify` drops. The dev-mode file watcher did not treat `.val.json` as a change either, so the Studio was never even prompted to look.

In dev (FS mode) the server now fingerprints the entry files — each file's size and modification time, never its content, so nothing is loaded that would not otherwise be — and reports it alongside the other shas. When it moves, the Studio refetches the entries it has cached.

Production is unaffected: content there comes from the remote and a deploy restarts the server, so there is nothing to detect, and the fingerprint is never computed or sent.
