---
"@valbuild/server": minor
"@valbuild/cli": minor
---

`val validate` now checks `.jsonValues()` entry content, and rejects a nested `.jsonValues()`.

It previously reported such a module as valid no matter what its entries contained: the record's schema only asserts that each entry is a lazy marker, and deep validation is deferred to whoever loads the entry — which the CLI never did. A `*.val.json` with a broken value therefore passed CI and only surfaced later in the Studio. Nested `.jsonValues()` had the same split: rejected by the Studio, reported valid by the CLI.

Errors point into the entry's own file, with a code frame:

```
content/kb.val.ts  ✘ 1 error  (30ms)
│  ✘  content/kb/entry-005.val.json:5:13
│     Key 'does-not-exist' does not exist in /content/authors.val.ts…
│     5 |   "author": "does-not-exist",
│       |             ^^^^^^^^^^^^^^^^
```

> **Heads up: a project with broken entry content will now fail `val validate` where it used to pass.** The content was already broken; only the reporting is new. Validation of such a module also takes longer, because it now reads every entry.

Also exported from `@valbuild/server` for tooling that maps a source path back to a location: `createJsonEntryPathMap` and `findJsonEntryFilePath`.
