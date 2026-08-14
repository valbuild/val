---
"@valbuild/server": patch
"@valbuild/cli": patch
---

Add `val debug`, which captures a self-contained snapshot of a project's pending patches so a publish failure can be reproduced somewhere else.

When a publish fails with "Failed to create commit", there was no way to see which change was at fault, and no way to reproduce it: the studio's compare view applies patches client-side with `JSONOps` and **silently skips** any patch it cannot apply (`console.debug` only), while `/save` applies them to the `.val.ts` AST with `tsOps` and refuses the whole commit. The compare view is therefore green by construction, and the 400's details never reach the editor.

`val debug` writes a zip that is itself a minimal Val project: the modules the pending patches touch plus the ones those reference (`keyOf`, `image`/`file` `referencedModule`, router modules) and their transitive relative imports, a generated `val.modules.ts`, the patch chain in the layout `ValOpsFS` reads, and a manifest recording the branch, the commit the module sources were read at, and the `@valbuild/*` versions the project was running. Module text comes from the ops rather than the local working copy — in http mode those differ, which is often the bug. It is read-only, and `--remote` reads the patches from the hosted project using the token from `val login`.

Unzip a snapshot into `debug/` in the val repo, check out the version from its manifest, and `pnpm debug:replay debug/<name>` replays it through the ordinary `analyzePatches` → `prepare` → `validateSources` path, then diffs the result against the report captured at snapshot time so "reproduced" is distinguishable from "behaves differently on this version".

`val delete-unappliable-patches` removes the patches that cannot be applied, which is what unblocks such a publish. It is a separate command so that capturing a snapshot is always read-only — take the snapshot first, since deleting discards the changes those patches contain.

Supporting changes in `@valbuild/server`:

- `PreparedCommit` now carries `unappliablePatches`, keyed by patch id. `sourceFilePatchErrors` says a module failed but not _which patch_ caused it, which is what a caller needs in order to report or remove it.
- `prepare` accepts `{ continueOnError }`. Default is unchanged, so `/save` still aborts the module and refuses the commit; with the flag the chain continues on the unchanged source file, so one run reports every unappliable patch rather than the first per module. The commit is still refused either way.
- New `getSourcesWithPatchesApplied`, which overlays the patched sources onto all sources. `getSources(analysis)` returns only the modules that had patches, which is not enough to validate with: cross-module checks (`keyOf`, router routes) resolve against other modules' sources and otherwise report spurious errors.
- `ValOpsHttp` accepts a personal access token (`x-val-pat`) as well as an api key, matching `getSettings` / `uploadRemoteFile` / `getPresignedAuthNonce`.
- `ValOpsFS`, `ValOpsHttp`, `loadValModules`, `formatPatchSourceError` and the snapshot replay helpers are now exported.
- Fixed the truncated "Could not your changes" error message.
