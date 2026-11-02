---
"@valbuild/core": patch
"@valbuild/shared": patch
"@valbuild/server": patch
---

**A JSON Patch `test` op now fails when it does not hold.** A `test` op is a
precondition: "only apply this patch if the value at this path is still
this". Val used to accept every `test` op without checking it, so a patch
that should have been refused was applied anyway.

Now a `test` op fails its patch when the path does not exist, or when the
value there is not deeply equal to the one given (objects and arrays are
compared all the way down, and `0`, `""`, `false` and `null` are all
different from each other). The ops after it are not applied. This holds in
every place Val applies a patch -- the Studio's drafts, a draft page, the
content tools for MCP, and Publish -- so a patch a draft shows is a patch
Publish accepts.

Nothing in the Studio, the CLI or the content tools writes `test` ops of
its own, so this only changes anything for a patch you, or an agent through
the MCP `create_patch` tool, wrote with a `test` op in it: one whose test
does not hold is now refused with `Test failed` (or, for a path that does
not exist, `Path refers to non-existing object/array`) instead of applied.
