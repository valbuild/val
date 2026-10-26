---
"@valbuild/cli": patch
"@valbuild/core": patch
"@valbuild/mcp": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/language-server": patch
"@valbuild/ui": patch
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
│     content/images.val.ts:8:5  /public/val/images/image-1_00001.png
│     content/images.val.ts:9:5  /public/val/images/image-2_00002.png
│     content/images.val.ts:10:5  /public/val/images/image-3_00003.png
│     content/images.val.ts:11:5  /public/val/images/image-4_00004.png
│     … 2 more
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
- In the Studio, **Check everything** on the Validate page lists them with a
  **Fix** button that uploads them, so a hosted project, which
  has no command line, can move its template's images and files to remote
  storage. That covers images, files and videos (a video's poster, captions
  and HLS stream go up with it), images inside rich text included, and the
  fields that picked a gallery image or a video from a set are updated with
  it.
- On a hosted project, **Check everything** no longer reports the template's
  images and videos as "The file is gone", and no longer offers a Fix that
  would remove them from their gallery or video set.

Fixable errors are now printed with `✘`, like every other error, instead of
the `⚠` warnings use. They were always errors and still make `val validate`
fail.
