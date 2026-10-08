# Full validation in the Studio

> **Status: plan.** Nothing below is implemented yet.

A page in the Studio that runs the whole of `val validate` — sources, local
files and remote files — and offers each fix as an ordinary pending change,
reached from a button in the top bar.

Companion to `valbuild/home` `docs/remote-files-on-platform.md`, which needs
this to be the way a managed project gets its remote refs fixed.

---

## Why

Three facts, each found in the code:

1. **The Studio hides every file error.** `partitionValidationErrors`
   (`shared/src/internal/validation/partitionValidationErrors.ts`) puts every
   metadata, remote, gallery-directory and all-files fix code in `skipped`, on
   the grounds that "the server (ValOps + createFixPatch) resolves all of these
   automatically on save, and the CLI's `runValidation` does the same".
2. **The server does not resolve them on save.** `createFixPatch` is called by
   the CLI (`cli/src/runValidation.ts`) and the language server, and by nothing
   in `ValOps` or `ValServer`. The `/sources/~` route can validate binary and
   remote files (`validate_binary_files`), but the Studio asks for neither
   (`createValSystem.ts` passes `false` for both), and the remote result is
   thrown away (`ValServer.ts`: "TODO : actually do something with this").
   What does happen on save is the upload of pending remote files at publish.
3. **A managed project has no CLI.** It has no repository, so nobody can run
   `val validate --fix` for it. Whatever is skipped in (1) is never fixed.

So today, for a managed project, a missing image width, a remote file that was
never uploaded, or a ref on a host that stopped answering is invisible in the
Studio and unfixable outside it. A connected project can be fixed from a
terminal, but only by someone with the repository and a `val login`.

## What it is

- **A page, `/val/validate`**, beside `/val/history` and `/val/errors` in
  `ValRouter.tsx`.
- **A button in the top bar** (`TopBar.tsx`), next to History, always shown:
  every mode has something to validate. It carries a count from the light
  check that runs when the Studio opens (below), replaced by the full check's
  count once one has run in this session. A number nothing has checked is not
  one it should show.
- **"Check everything"** on the page runs the full validation and fills the
  page as results arrive, module by module.
- **Each error that has a fix gets a Fix button**, each module a "Fix all", and
  the page a "Fix everything". A fix becomes a **pending change**, reviewed and
  published like any edit. The page never writes a file and never publishes.
- **An error with no fix** (a custom `.validate()`, a schema mismatch) links to
  the field, as `/val/errors` does, or says that a developer has to change the
  schema.

### Every row offers its next step

Per the error rule in `.claude/CLAUDE.md`, a row is not finished until it says
what the person can do:

| The row                                 | What it offers                                                              |
| --------------------------------------- | --------------------------------------------------------------------------- |
| An error with a fix                     | **Fix**, which adds the pending change and opens it for review              |
| An error in a field someone can edit    | **Open**, which goes to the field                                           |
| A schema or code problem                | Says a developer has to change the schema, and names the module             |
| A remote file whose host did not answer | **Try again**, and says which host failed and whether the fallback answered |
| A module the run ran out of time on     | **Check this module**, which runs it alone                                  |
| `external:upload`                       | The command to run, `val external upload`, with a copy button               |

A raw network error or stack trace goes under "Details", never in place of
the sentence.

### How it relates to `/val/errors`

`/val/errors` is the publish gate's list: a snapshot of the errors the
Studio's own validator found, opened from the Publish button's "Fix N"
(`ValidationErrors.tsx`). It is fast, client-side, and covers sources only.

`/val/validate` is the full check: run on the server, slower, and covering
files. They render rows with the same components (`FieldErrorList`, the
module grouping in `ValidationErrors.tsx`) so an error looks the same on both.
They stay two pages, so the publish gate does not get slower.

## The light check, when the Studio opens

Remote refs only, HEAD requests only, and not every ref:

- **Published refs: one per host.** Every ref in published content that no
  pending patch touches is assumed to stand or fall with its host, so the
  check takes one ref per distinct host and HEADs it. In a managed project
  that assumption holds by construction: refs are only ever written by the
  Studio, and a host changes for every ref at once (a domain is added or
  removed for the whole project), so one ref cannot break on its own without
  a patch. A project has a handful of hosts at most, so this is a handful of
  requests.
- **Patched refs: every one.** A ref in a pending patch is where a single file
  can be wrong on its own: an upload that failed half way, a file added while
  a domain was changing. Each gets its own HEAD. There are rarely many.
- **Connected projects rely on CI for the rest.** Their refs live in git, where
  a developer can edit one by hand, so "one per host" is not guaranteed. That
  is covered by `val validate` running before every publish (below), not by
  the Studio.

A host that fails is one row on the page — "Images on `www.acme.no` cannot be
reached" — with the count of refs it covers and **Fix**, which rewrites them
to the project's current host. A patched ref that fails is a row of its own,
with **Try again** (re-upload, when the Studio still has the bytes) or
**Remove**. Results are kept for the session; nothing is re-checked on every
navigation.

### What connected projects need: `val validate` before `val publish`

The assumption above is only true if something checks the whole of a
connected project before it goes live, and today nothing does. The workflow
the templates ship (`val-publish.yml` in `valbuild/template-tanstack-starter`)
runs `pnpm exec val publish` and nothing else, and `val publish`
(`packages/cli/src/publish.ts`) does not validate.

**`val publish` runs the full validation first and refuses to publish on an
error**, without `--fix`: CI must not rewrite the content it was asked to
publish. Putting it in `val publish` rather than in the workflow file means
every connected repository gets it on its next `@valbuild/cli` bump, including
the ones whose workflow file was written before this existed. The failure goes
through `val ci-report --status failed` like any other, so the Studio already
shows it with **View run**.

## What is checked

Everything `val validate` checks, from the same code:

| Check                                   | Codes                                                          | Needs                         |
| --------------------------------------- | -------------------------------------------------------------- | ----------------------------- |
| Sources against schemas                 | keyof, router, locale, record, jsonValues, view                | sources, schemas              |
| Local file metadata                     | `image:*-metadata`, `file:*-metadata`, `video(s):add-metadata` | the file's bytes              |
| Remote files: present, hashed, metadata | `*:check-remote`, `*:upload-remote`, `*:download-remote`       | the remote bytes, or a HEAD   |
| Remote ref on a host the project left   | the new code from the remote-files plan                        | the project's current hosts   |
| Gallery directories                     | `*:check-unique-folder`, `*:check-all-files`                   | a list of the project's files |

`external:upload` is shown but **not** offered: it writes to live data, which
is why `val validate --fix` does not apply it either. The page says to run
`val external upload`.

## How a fix is applied

The server builds the fix with `createFixPatch`, as the CLI does, and returns
the **patch**. The Studio applies it through the normal patch path: `addPatch`,
or `addAndUploadPatchWithFileOps` when the fix carries bytes (a remote upload,
a download to local). From there it is a pending change like any other.

- **The same in every mode.** In fs mode `ValOpsFS` writes the patch into the
  `.val.ts` at publish, exactly as for an edit. There is no second write path.
- **Remote uploads use the app's credential.** `resolveRemoteFileAuth` already
  answers with the api key in http mode and the `val login` token in fs mode,
  so the Studio never asks an editor for a personal access token.
- **A fix is an edit.** Whoever can edit the field can fix it.

## What has to change for the server to do this

### `createFixPatch` reads bytes from a reader, not from disk

It takes `config.projectRoot` and reads with `fs` (`getImageMetadata`,
`getFileMetadata`, `getVideoMetadata`, the reads around line 540), and the
`*:download-remote` branch writes to disk with `fs.promises.mkdir` (around line
497). Neither works in http mode, where there is no disk, nor on the platform,
where the app runs in a Worker isolate.

- Replace `projectRoot` with a reader, `readFile(path) → Buffer | null`,
  supplied by the caller: `ValOpsFS` reads the disk, `ValOpsHttp` asks content
  (`getBinaryFile`, which already handles repo and patch locations), and the
  CLI and language server pass a disk reader so they do not change.
- Remote bytes go through the fallback download from the remote-files plan
  (hash-checked, `<publicProjectId>.valstart.dev` when the ref's host fails).
- A download-to-local fix returns a `file` op carrying the bytes instead of
  writing them, so it goes through the same upload as any added file.
- Metadata extraction is already pure: `image-size` and the EBML reader work
  on a `Buffer`, so nothing else needs a platform branch.

### `validateRemoteFiles` is implemented

It is a stub today. It shares its check with the CLI's `checkRemoteRef`
(`server/src/checkRemoteRef.ts`) rather than growing a second one.

### The gallery checks get a file list

`*:check-all-files` lists a gallery's directory, which `validateSources`
cannot do ("Requires filesystem access to enumerate the gallery directory",
`ValOps.ts`). `ValOps` gains a `listFiles(dir)`: the disk in fs mode, and in
http mode the project's public files as content knows them (`publicPaths` /
`publicFiles` from `/project-source`).

## How it runs

**The Studio drives it one module at a time.**

```
POST /api/val/validate   { module: "/content/pages.val.ts" }
  → { errors: Record<SourcePath, ValidationError[]>, partial?: true }

POST /api/val/validate/fix   { module, sourcePath, fix }
  → { patch: Patch, remainingErrors: ValidationError[] }
```

- **One request per module**, in sorted module order. Progress is the request
  count, there is no job to store or resume, and every request is bounded,
  which matters on the platform where the app's server is a Worker isolate
  with CPU and time limits.
- **A module that cannot finish in time says so** (`partial: true`), the same
  way `search_content` reports `omittedModules`: "ran out of time" must not
  read as "nothing wrong".
- **Remote checks avoid downloading.** Existence is a HEAD. Bytes are
  downloaded only when metadata has to be read or the validation hash does not
  match. A verdict for a ref is cached for the life of the server process,
  since a ref is content-addressed and its answer only changes if its host
  stops working.
- **Same session auth** as every other `/api/val` route.

## Changes, by package

- **core:** nothing beyond the new fix code from the remote-files plan.
- **shared:** routes and zod schemas for the two endpoints in `ApiRoutes.ts`.
  `partitionValidationErrors` is unchanged: it still decides what the publish
  gate shows. The new page does not go through it.
- **server:** the reader in `createFixPatch`; `validateRemoteFiles`;
  `listFiles` in `ValOps`; the two routes in `ValServer`.
- **ui:** the `/val/validate` route and page, the top bar button and its count,
  and applying a returned patch through the existing patch path.
- **cli:** passes a disk reader to `createFixPatch`, and `val publish` runs
  the full validation before it builds.
- **language-server:** passes a disk reader to `createFixPatch`. Its
  behaviour does not change.
- **valbuild/home:** nothing new: content already serves the bytes and the
  file list `ValOpsHttp` needs.

## Order of work

1. **The reader in `createFixPatch`**, with the CLI and language server passing
   a disk reader. A refactor with no visible change; the CLI's tests pin it.
   **Done** for image, file and video metadata and for downloading a remote
   file (`FixFiles` in `server/src/fixFiles.ts`; the CLI and the language
   server get `diskFixFiles` by default). Still on disk: the gallery checks,
   which need `listFiles` (step 5), and `checkRemoteRef`'s download cache
   (step 4).
2. **The two routes**, for source and local-file checks only.
3. **The page and the top bar button.** Useful from here for local metadata.
4. **`validateRemoteFiles`** and the remote fixes.
5. **`listFiles`** and the gallery checks.
6. **The host rewrite** from the remote-files plan, which then needs nothing
   here but its own fix code.
7. **The light check on open**, once the host rewrite exists to fix what it
   finds.
8. **`val validate` inside `val publish`** (cli), independent of the rest and
   can land first. **Done**: `validateOnce` in `cli/src/validate.ts` is the
   one pass both commands run, and `--skip-validation` is the way past it.

Each step is shown working in `examples/tanstack` (fs mode) and through the
`chromium-http` project's mock content host (http mode) before the next.

## Open questions

- **How long may `val validate` take inside `val publish`?** The remote
  checks download bytes where metadata has to be read. A CI run that doubles
  in length is a cost on every publish of a connected project; the verdict
  cache helps within a run, not across runs.
- **What does `check-all-files` mean for a managed project?** Its "directory"
  is the build's `public/` plus whatever the Studio has uploaded since. Content
  knows both, but the answer has to be one list.
- **Who sees "Fix everything"?** Bulk fixes are edits to many modules at once;
  fine for a developer, possibly surprising for an editor.
