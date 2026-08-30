---
"@valbuild/language-server": patch
"@valbuild/server": patch
---

Offer editor quick fixes inside a `.jsonValues()` entry

An error inside a `.jsonValues()` entry — an `s.image()` with stale dimensions,
say — got no quick fix in the editor, and no explanation either. The action was
computed and then silently dropped.

Two things were wrong. The entry's value is not in the `.val.ts`, which holds
only `c.json(() => import("./x.val.json"))`, so applying the fix patch to that
file walked into the thunk and failed. And the diagnostic had nowhere to sit:
nothing in the `.val.ts` matches a path that continues below the entry key, so
every error inside every entry collapsed onto line 1 — for a record with
hundreds of entries, hundreds of diagnostics stacked on the first line, none of
them naming an entry.

Now the diagnostic is reported at the entry's key, and the quick fix edits the
entry's own `*.val.json` as a cross-file workspace edit, routing the patch the
same way the Studio's publish and `val validate --fix` do. The entry file is
read through the editor's buffers, so an unsaved entry is fixed as the editor
has it rather than as the disk has it, and `*.val.json` is now watched — editing
one, or having a quick fix write one, revalidates the module that reads it
instead of leaving a diagnostic that nothing can clear.
