---
"@valbuild/server": patch
"@valbuild/ui": patch
---

Putting a whole module back works for `.jsonValues()` records

A `.jsonValues()` record's entries are not in the module's source: the `.val.ts`
holds `c.json(() => import("./entry.val.json"))` per entry and the content lives
in those files. Val already routed a patch that named an entry key into the
right file, but a patch that replaced the **whole record** named no key — so it
was applied as an ordinary source edit, writing over the imports that make the
entries load at all. "Put everything back" in the history pane left such a module
out for exactly that reason.

A whole-record write is now expanded into per-entry ops before anything acts on
it: an entry added, one removed, one changed, and nothing at all for an entry
that already holds what the write says — so putting a module back does not
rewrite every file in it. The same expansion produces the draft the Studio shows
and the files a publish writes, so a draft cannot show one thing and publish
another.

Nothing that writes a patch has to know a record is `.jsonValues()`: write the
module as if it were ordinary content, and it lands in the right files.

"Put everything back" and "Restore this whole module" now cover `.jsonValues()`
modules. They read each entry as it was at the commit and put the content back —
never the recorded source, which is markers rather than content, and is now
refused rather than written.
