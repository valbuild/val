---
"@valbuild/server": patch
"@valbuild/tanstack": patch
"@valbuild/next": patch
"@valbuild/cli": patch
---

`val validate --fix` now formats with your prettier config instead of prettier's defaults

`--fix` formatted the files it repaired by calling `prettier.format(code, { filepath })`, which never reads `.prettierrc`: `filepath` picks the parser and nothing else — only `resolveConfig`, `getFileInfo` and prettier's own CLI consult the config. On a project whose style is not prettier's default, a two-line content fix therefore arrived as a whole-file rewrite, and in a repo with a format check in CI it turned a content fix into a red build.

There is now one implementation of "format a written file the way this project does", `createPrettierFormatter`, exported from `@valbuild/server` and re-exported by `@valbuild/next/server` and `@valbuild/tanstack/server`. It resolves `.prettierrc` for each file (including any `overrides` that match it), leaves anything in `.prettierignore` untouched, and falls back to prettier's defaults when the project has no config. `val validate --fix` uses it, so the CLI and the Studio can no longer disagree about formatting.

Use it for your app's `formatter` too — this is the recommended setup, and it replaces reading `.prettierrc.json` by hand:

```ts
import prettier from "prettier";
import { initValServer, createPrettierFormatter } from "@valbuild/next/server";

const { valNextAppRouter } = initValServer(
  valModules,
  { ...config },
  {
    draftMode,
    formatter: createPrettierFormatter(prettier, {
      projectRoot: process.cwd(),
    }),
  },
);
```

Existing `formatter` callbacks keep working unchanged.
