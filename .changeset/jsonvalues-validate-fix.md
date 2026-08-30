---
"@valbuild/server": patch
---

Fix `val validate` crashing on a `.jsonValues()` entry that contains a file

A module using `.jsonValues()` keeps its entry content in separate `*.val.json`
files, so the `.val.ts` holds a `c.json(() => import(...))` marker where the
value would be. Validation loads those files and reports errors at paths INSIDE
an entry — but the fix handlers resolved such a path against the module source,
which still had the marker, and resolving into a marker throws.

An `s.image()` or `s.file()` inside an entry hits this every time. Media metadata
can only be checked against the bytes themselves — an image's stored width and
height, a file's mime type — which is something the schema deliberately cannot
do, so it is always handed on as a fix rather than settled during validation. The result was that a single image in a
jsonValues entry aborted the whole run:

```
❌Error: Cannot resolve path into a jsonValues entry until its content is loaded. Path: "/jobb/student"."pageImage"
```

No report, no exit code, nothing fixable — and `--fix` could not get out of it,
because the crash came before any fix ran.

The loaded entry content is now substituted back into the source before anything
resolves a path against it, and `Service.patch` routes an op that lands inside an
entry to that entry's `*.val.json` instead of the `.val.ts` — the same routing
the Studio's publish already does. So `val validate --fix` writes image metadata
into the entry file, and the next run is clean.
