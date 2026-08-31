---
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
---

Read how a module looked at any past commit

Val could publish but not look back. `getHistoricalComparison` works out
how each module looked before a given commit, how the commit left it, how
that compares to the source right now, and whether the old value still fits
the schema as it stands today — which is what decides whether a restore can
be offered at all.

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

Four new `/api/val` routes, split by how they cache: a reconstructed commit
cannot change and is immutable forever, the comparison against current
source changes with every edit, and a file at a fixed commit is immutable
too. Binary files are named rather than fetched — only an `<img>` that
mounts pays for its bytes.

History requires the content service. `ValOpsFS` reports
`not-supported-in-fs-mode` rather than faking it from git, which has the
files but not which of a commit's changes were one editor's patch set.
