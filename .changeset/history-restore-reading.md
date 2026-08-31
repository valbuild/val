---
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

Read how a module looked at any past commit, and what restoring it would take

Val could publish but not look back. `getHistoricalPatchSet` reconstructs a
commit — how each module looked before it, and how the commit left it — and
`computeRestorePatches` turns that into the ops it would take to put that
version back, grouped into units a user can restore one at a time.

The source is read statically: parse the `.val.ts`, evaluate the literal
`c.define` was given. Reconstructing an old commit must not execute code
from it, and evaluating a historical module would need the imports it had
then. This is the same narrowness Val's own patching relies on — `TSOps`
edits literals, so a module whose source is not literal was never patchable.

Everything is `Result`-typed against one closed `HistoryError` union, since
the ways this fails are the interesting part: a record written by an older
Val, a source that no longer parses, an op that will not replay, a schema
that has moved on. Whole-commit failures are the error channel; per-module
ones ride inside the success payload, so one unparseable module leaves the
others readable.

Three new `/api/val` routes, split by how they cache: a reconstructed commit
cannot change and is immutable forever, a listing does not, and a file at a
fixed commit is immutable too. Binary files are named rather than fetched —
only an `<img>` that mounts pays for its bytes.

Comparing a commit against the CURRENT source happens in the Studio rather
than over the network. The recompute trigger is local — the patch chain
moved — and the client already holds the current source, the serialized
schemas and a schema validator on its own worker thread, so a round trip
would be answering a question it can answer itself.

The diff that drives a restore emits only `replace`/`add`/`remove`. Arrays
decide the shape: `JSONOps` applies array add/remove with `splice`, so
indices shift, while `replace` assigns and shifts nothing — a same-length
array therefore gets one `replace` per differing index (per-item restore
units, order-independent) and a length change gets one `replace` of the
whole array.

History requires the content service. `ValOpsFS` reports
`not-supported-in-fs-mode` rather than faking it from git, which has the
files but not which of a commit's changes were one editor's patch set.
