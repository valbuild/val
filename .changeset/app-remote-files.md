---
"@valbuild/core": minor
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
"@valbuild/cli": minor
"@valbuild/language-server": minor
"@valbuild/init": minor
---

New: `files: { remote: true }` in `val.config.ts` stores every image, file and video on Val's remote content host.

```ts
const { s, c, val, config } = initVal({
  project: "myorg/myproject",
  files: { remote: true },
});
```

With it, `s.image()`, `s.file()`, `s.video()`, `s.imageset()`, `s.fileset()`, `s.videoset()` and `s.richtext({ img: true })` behave as though `.remote()` had been written on them. Images already in the project are reported as `image:upload-remote` until they are uploaded; `npx val validate --fix` does that.

**Required in the Val app.** A project running there (`VAL_ENV=app`) refuses to start without it, with an error that says what to add, and `val publish` refuses before it builds.

**Breaking:** `files.directory` has been removed from `val.config.ts`. Local files that have no `dir` of their own are stored in `/public/val`, which was the default.
