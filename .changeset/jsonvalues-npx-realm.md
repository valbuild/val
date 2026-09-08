---
"@valbuild/server": patch
---

Fix `.jsonValues()` validation being silently skipped when the CLI is run through `npx` / `pnpm dlx`.

`npx @valbuild/cli validate` reported a `.jsonValues()` module whose entries were still written inline in the `.val.ts` as **valid**, and `--fix` moved nothing into `*.val.json`. Running the CLI installed in the project (`./node_modules/.bin/val validate --fix`) worked, which made this look like a schema or path problem rather than a tooling one.

The cause: the project's `*.val.ts` are evaluated with a `require` rooted at the project, so their schemas come from the project's `@valbuild/core`, while `npx`/`dlx` runs the CLI's own second copy. The entry check guarded on `schema instanceof RecordSchema`, which is false across those two copies, and it failed open — the whole check returned "no errors". The guard is now structural, so it holds whichever copy built the schema. If you gate CI on `npx @valbuild/cli validate`, that gate was green for the wrong reason.
