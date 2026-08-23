---
"@valbuild/core": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/cli": patch
"@valbuild/ui": patch
---

Validate that a `.jsonValues()` entry's `*.val.json` is at the path its key derives.

The key↔file mapping of a `.jsonValues()` record is canonical: the file is named after the entry key, under a folder named after the `.val.ts`. Every write already derived it that way, but nothing checked what was already in the module — so an entry could point at any file in the project and `val validate` would call it valid. The mapping was a convention the tooling followed and the source was free to contradict.

`val validate` now reports a mismatch (reading the specifier from the `.val.ts` AST, since a bundler rewrites the one in the thunk), and `val validate --fix` applies the new `jsonValues:rename-entry-file` fix: it moves the file to the derived path and rewrites the entry's `import(...)` in place, so the entry keeps its position in the record. It refuses rather than overwrite anything already sitting at the destination.

The loader is unchanged: a thunk still loads whatever path it names, and the Studio still edits a hand-placed file in place. Only where the file is allowed to live is now checked, and only by the CLI — the Studio never produces a non-canonical path.
