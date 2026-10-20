---
"@valbuild/cli": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/language-server": patch
---

`val validate` no longer fails a project just because some of its files are
local while the project stores files remotely (`files: { remote: true }` or
`.remote()`). Every project made from a template starts like that, and the
site serves those files from `public/` until they are uploaded. They are now
reported as **warnings**, grouped into one block per file with the command
that uploads them:

```
content/images.val.ts  ⚠ 7 warnings  (12ms)
│
│  ⚠  Local files in a project with remote files. Your site serves them from public/ for now; they move to remote storage when uploaded.
│
│     content/images.val.ts:7:5  /public/val/images/image-0_00000.png
│     … 6 more
│
│     → val validate --fix uploads them (needs val login)
│

✔ No validation errors · 7 warnings in 1 file
```

- `--strict` on `val validate` and `val publish` makes warnings fail too.
- `val validate --fix` still fails when it cannot upload them, for example
  when you are not logged in.
- A local file that does not exist is still an error.
- The language server shows these as warnings.

Fixable errors are now printed with `✘` instead of `⚠`. They were always
errors and still make `val validate` fail; `⚠` now means a warning.
