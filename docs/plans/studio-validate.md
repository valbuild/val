# Full validation in the Studio

> **Status: plan.** Steps 1, 2 and 7 are done (see Order of work); the rest is
> not built yet.

The Studio's errors page, grown so that it can also run the whole of
`val validate` — sources, local files, remote files and media sets — and
offer each fix as an ordinary pending change, reached from a button in the top
bar.

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

- **One page, `/val/validate`.** It is the errors page the Studio already
  has (`/val/errors`, `ValidationErrors.tsx`), grown, not a second page beside
  it. `/val/errors` redirects there, and the Publish button's "Fix N" opens
  it as it does today.
- **A button in the top bar** (`TopBar.tsx`), next to History, always shown:
  every mode has something to validate. Its count is the one the publish gate
  already has, from the Studio's own validator, so it costs no request; after
  a full check has run in this session it includes that check's errors too.
- **"Check everything"** on the page runs the full validation and fills the
  page as results arrive, module by module. **Nothing runs it on its own**:
  not when the Studio opens, not on navigation. It runs when someone presses
  it.
- **Stop** ends a run between modules and keeps what was already checked; the
  rest reads as not checked, never as clean.
- **Results last for the session.** The page says when the full check last ran
  ("Checked everything 2 min ago") and offers **Check again**; nothing re-runs
  it behind anyone's back, and a reload starts from the Studio's own check.
- **Each error that has a fix gets a Fix button**, each module a "Fix all", and
  the page a "Fix everything", shown to everyone who can open the page: the
  Studio has no roles that hide actions from editors, and this page does not
  invent one. A fix becomes a **pending change**, reviewed and
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

### One page, two depths

What the page shows straight away is what `/val/errors` shows today: the
errors the Studio's own validator found, fast, client-side, sources only. That
part stays exactly as fast, because it is the publish gate.

"Check everything" adds the rest below it, from the server: files, remote
files and the media sets. Rows from both look the same (`FieldErrorList`, the
module grouping in `ValidationErrors.tsx`), and a row the full check also
found is shown once.

### Remote refs in the full check

How many refs the full check asks about depends on who could have written
them:

- **Managed projects: published refs one per host, patched refs every one.**
  Refs in a managed project are only ever written by the Studio, and a host
  changes for every ref at once (a domain is added or removed for the whole
  project), so a published ref cannot break on its own: the check HEADs one
  ref per distinct host and takes the answer for all of them. A ref in a
  pending patch can be wrong on its own (an upload that failed half way), so
  each of those gets its own HEAD.
- **Connected projects: every ref.** Their refs live in git, where a developer
  can edit one by hand, so "one per host" is not guaranteed.

A host that fails is one row — "Images on `www.acme.no` cannot be reached" —
with the count of refs it covers and **Fix**, which rewrites them to the
project's current host. A patched ref that fails is a row of its own, with
**Try again** (re-upload, when the Studio still has the bytes) or **Remove**.

### What connected projects need: `val validate` before `val publish`

A connected project's content also changes outside the Studio, so the Studio
cannot be the only place it is checked, and nobody has to press anything for
the check that matters most to run. The workflow the templates ship
(`val-publish.yml` in `valbuild/template-tanstack-starter`) runs
`pnpm exec val publish` and nothing else, and `val publish` did not validate.

**`val publish` runs the full validation first and refuses to publish on an
error**, without `--fix`: CI must not rewrite the content it was asked to
publish. Putting it in `val publish` rather than in the workflow file means
every connected repository gets it on its next `@valbuild/cli` bump, including
the ones whose workflow file was written before this existed. The failure goes
through `val ci-report --status failed` like any other, so the Studio already
shows it with **View run**.

## Sketches

The agreed UX, as ASCII. Wording is indicative; the structure is not.

**Top bar.** Validate sits next to History. Its count is the one the publish
gate already has, so it costs no request.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◧ Val   Pages  Explorer  Media                 [Publish ▾ Fix 3]  ✓3  ⟲  ✦ │
└────────────────────────────────────────────────────────────────────────────┘
                                                                     │   │  └ AI
                                                                     │   └ History
                                                                     └ Validate
```

**`/val/validate` on arrival.** Today's errors page: what the Studio already
knows, and nothing has been asked of the server.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Validate                                                                   │
│ 3 errors in 2 files · from the Studio's own check        [Check everything]│
│                                                                            │
│ content/blog.val.ts                                                   2    │
│ ├─ ✘ /blogs/hello · title                                                  │
│ │    Must be at most 80 characters (is 94)                         [Open]  │
│ └─ ✘ /blogs/hello · author                                                 │
│      "kari" is not a key in authors.val.ts                         [Open]  │
│                                                                            │
│ content/menu.val.ts                                                   1    │
│ └─ ✘ items · 2 · link                                                      │
│      "/kontakt" is not a page on this site                         [Open]  │
│                                                                            │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ Files, remote files and media sets have not been checked.                  │
│ "Check everything" checks them on the server. It can take a minute.        │
└────────────────────────────────────────────────────────────────────────────┘
```

**While "Check everything" runs.** One module at a time, rows arriving as
they come.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Validate                                                                   │
│ Checking everything…  ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░  9 of 17 files        [Stop]   │
│                                                                            │
│ content/blog.val.ts  ✓ checked                                        2    │
│ content/menu.val.ts  ✓ checked                                        1    │
│ content/media.val.ts  checking…                                            │
│ content/videos.val.ts                                                      │
│ …                                                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

**After the run.** Every row ends in something the person can do.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Validate                                                                   │
│ 9 errors in 5 files · 6 can be fixed here        [Fix everything (6)]      │
│ Checked everything 2 min ago                     [Check again]             │
│                                                                            │
│ Remote files                                                               │
│ └─ ✘ Images on www.acme.no cannot be reached                               │
│      38 images in 6 files use this address. They are still served at       │
│      3f9a2c1.valstart.dev. Fix points them at www.acme-group.no.   [Fix]   │
│      ▸ Details                                                             │
│                                                                            │
│ content/media.val.ts  (image set)                                     3    │
│ ├─ ✘ /public/val/team_8a1f3.jpg                                            │
│ │    The file is gone, but the set still lists it.     [Remove from set]   │
│ ├─ ⚠ /public/val/office_2c9e0.jpg                                          │
│ │    Size is 1200×800 in the set, 2400×1600 in the file.          [Fix]    │
│ └─ ⚠ /public/val/logo_77b21.png                                            │
│      No width, height or type recorded.                           [Fix]    │
│                                                     [Fix all in this file] │
│                                                                            │
│ content/home.val.ts                                                   1    │
│ └─ ✘ hero · image   (in your unpublished changes)                          │
│      This image did not finish uploading.          [Try again]  [Remove]   │
│                                                                            │
│ content/blog.val.ts                                                   2    │
│ ├─ ✘ /blogs/hello · title   Must be at most 80 characters (is 94)  [Open]  │
│ └─ ✘ /blogs/hello · author  "kari" is not a key in authors.val.ts  [Open]  │
│                                                                            │
│ content/videos.val.ts                                                 1    │
│ └─ ⚠ Ran out of time before this file was finished.                        │
│      The rest of the page is complete.                [Check this file]    │
│                                                                            │
│ content/products.val.ts                                               1    │
│ └─ ✘ Entries written inline in an external record                          │
│      Moving them writes to live data, so it is not done here.              │
│      Run:  val external upload                                    [Copy]   │
└────────────────────────────────────────────────────────────────────────────┘
```

**A fix is a pending change.** The page never publishes.

```
  [Fix]  ──►  ┌──────────────────────────────────────────────┐
              │ ✓ Added to your changes                       │
              │   office_2c9e0.jpg: size 2400×1600            │
              │                          [Review]   [Undo]    │
              └──────────────────────────────────────────────┘

  Top bar now:   [Publish ▾ 1 change]  ✓8  ⟲  ✦
```

**A connected project's CI.** `val publish` refuses, and the Studio shows the
failed run as it shows any other.

```
$ val publish
Validating project 'acme/web'...
Found 17 files...
content/media.val.ts  ⚠ 1 fixable
│  ⚠  content/media.val.ts:12:5
│     Image metadata is missing
│     → run with --fix to apply
✘ 1 error (1 fixable) across 1 file · 16 valid
❌Error: Not published: 1 validation error.
    Run "val validate --fix" in the project, commit what it changes and push,
    and fix by hand what it cannot. --skip-validation publishes anyway.

Studio:  ┌───────────────────────────────────────────────────┐
         │ Published, not on the site yet. The build failed.  │
         │                                      [View run]    │
         └───────────────────────────────────────────────────┘
```

## What is checked

Everything `val validate` checks, from the same code:

| Check                                   | Codes                                                          | Needs                       |
| --------------------------------------- | -------------------------------------------------------------- | --------------------------- |
| Sources against schemas                 | keyof, router, locale, record, jsonValues, view                | sources, schemas            |
| Local file metadata                     | `image:*-metadata`, `file:*-metadata`, `video(s):add-metadata` | the file's bytes            |
| Remote files: present, hashed, metadata | `*:check-remote`, `*:upload-remote`, `*:download-remote`       | the remote bytes, or a HEAD |
| Remote ref on a host the project left   | the new code from the remote-files plan                        | the project's current hosts |
| Media sets                              | `*:check-unique-folder`, `*:check-all-files`                   | the set's own entries       |

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

### The media sets are checked by what they track

`s.imageset()`, `s.fileset()` and `s.videoset()` each hold a record of the
files they track, keyed by path. The Studio checks **those entries**: that
each tracked file exists, and that what the entry says about it (dimensions,
mime type, a video's length) matches its bytes. A tracked file that is gone
is a row with **Remove from the set**; an entry whose metadata is wrong is a
row with **Fix**.

It does not list the set's directory looking for files the set does not
track. `*:check-all-files` does that on disk today (`validateSources` cannot,
"Requires filesystem access to enumerate the gallery directory", `ValOps.ts`),
and it stays the CLI's: in a managed project nothing puts a file in a set's
directory except the set itself, so there is nothing untracked to find, and in
a connected project the files that could be untracked are in the repository,
where `val validate` sees them. So `ValOps` needs no `listFiles`, and http
mode needs no file list from content.

`*:check-unique-folder` needs no files at all: it compares the sets' `dir`
options across the schemas, and runs the same everywhere.

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
- **server:** the reader in `createFixPatch`; `validateRemoteFiles`; the
  tracked-entries half of the set checks, split from the directory listing
  the CLI keeps; the two routes in `ValServer`.
- **ui:** `/val/errors` grown into `/val/validate` (and the redirect), the top
  bar button and its count, and applying a returned patch through the
  existing patch path.
- **cli:** passes a disk reader to `createFixPatch`, and `val publish` runs
  the full validation before it builds.
- **language-server:** passes a disk reader to `createFixPatch`. Its
  behaviour does not change.
- **valbuild/home:** nothing new: content already serves the bytes
  `ValOpsHttp` needs.

## Order of work

1. **The reader in `createFixPatch`**, with the CLI and language server passing
   a disk reader. A refactor with no visible change; the CLI's tests pin it.
   **Done** for image, file and video metadata and for downloading a remote
   file (`FixFiles` in `server/src/fixFiles.ts`; the CLI and the language
   server get `diskFixFiles` by default). Still on disk: the set checks
   (step 5), and `checkRemoteRef`'s download cache (step 4).
2. **The two routes**, for source and local-file checks only. **Done**:
   `POST /validate` and `POST /validate/fix` (`server/src/studioValidation.ts`).
   The fix route finds the error again from its own reading of the module, and
   builds only the codes in `STUDIO_FIXES` (`shared/…/validation/studioFixes.ts`).
3. **`/val/errors` grown into `/val/validate`, and the top bar button.**
   Useful from here for local metadata.
4. **`validateRemoteFiles`** and the remote fixes.
5. **The set checks over the set's own entries**, read through `FixFiles`.
6. **The host rewrite** from the remote-files plan, which then needs nothing
   here but its own fix code.
7. **`val validate` inside `val publish`** (cli), independent of the rest and
   can land first. **Done**: `validateOnce` in `cli/src/validate.ts` is the
   one pass both commands run, and `--skip-validation` is the way past it.

Each step is shown working in `examples/tanstack` (fs mode) and through the
`chromium-http` project's mock content host (http mode) before the next.

## Open questions

- **How long may `val validate` take inside `val publish`?** The remote
  checks download bytes where metadata has to be read. A CI run that doubles
  in length is a cost on every publish of a connected project; the verdict
  cache helps within a run, not across runs.
