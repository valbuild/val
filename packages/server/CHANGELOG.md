# @valbuild/server

## 0.136.1

### Patch Changes

- [#716](https://github.com/valbuild/val/pull/716) [`4450be5`](https://github.com/valbuild/val/commit/4450be570ec3a66d7d98ba273c333ca2d2f163d9) Thanks [@freekh](https://github.com/freekh)! - `rebakeGit` rewires a project record to a different commit, and the Studio's publish proxy can now reach `/project-source`.

  Both are groundwork for a publish that happens in the browser. `rebakeGit` replaces the one line in the generated `val.server.ts` that carries the commit, rather than regenerating the file: a publisher running inside the deployment does not know the project id or the platform's address, and reconstructing the file from what it could guess would throw away wiring it cannot see.

- [#716](https://github.com/valbuild/val/pull/716) [`d2f385a`](https://github.com/valbuild/val/commit/d2f385a04978992a5036379235e447ba7775faef) Thanks [@freekh](https://github.com/freekh)! - The Studio works again when served from the published package, and a managed project's publish now puts the saved edit on the site.

  - **The Studio did not start in 0.136.0.** Its main bundle imports sibling chunks by relative path, and the Studio is served at `/api/val/static/<version>/app`, so those imports resolved to paths the handler did not know and came back as the HTML fallback — which a browser refuses as a module script. Preview was gone with it. The handler now serves those chunks, and the package build follows every import the bundle makes before it lets a release through.
  - **The in-browser builder could not load.** The Studio's bundle carried rolldown's Node WASI binding, which throws `process is not defined` in a tab. It now uses the browser binding, and the build refuses a bundle that contains the Node one.
  - **A managed publish builds what was just saved.** `/save` returns the source files the commit wrote, the Studio builds with them laid over the project's stored source, and publishes that source back with the build — so the next edit starts from this one rather than undoing it. The save's commit is also passed through to the build, which previously ran as though no commit had been made.
  - **The bundler's WebAssembly is served from `content.val.build/v1/static`** (`DEFAULT_STATIC_HOST`), still addressed by its SHA-256. `globalThis.__VAL_ROLLDOWN_WASM_URL__` still overrides it.
  - The `val.server.ts` that `@valbuild/tanstack-build` generates no longer hands a save's files to the platform (`platform.internal/__api/source`). A managed project's Studio builds in its own tab, and the platform has closed that door. `isWired` recognises files wired either way.
  - `@valbuild/tanstack-build/constants` exports the contract paths and the artifact key namespace from an entrypoint that imports nothing else, for callers that must not load the bundler. The namespace gains a `source` key.

- Updated dependencies [[`cf89e74`](https://github.com/valbuild/val/commit/cf89e7429a79c4304ecbedd4f8b571a0de0f145f), [`c219574`](https://github.com/valbuild/val/commit/c21957498f3c7f4f47cef197c5dc0d591aa744ca), [`e673b43`](https://github.com/valbuild/val/commit/e673b43feaf48b7f30881d6786c858a0cb6a44a2), [`5c82928`](https://github.com/valbuild/val/commit/5c82928992d29f133f81cf0704a273c0449b18f1), [`d2f385a`](https://github.com/valbuild/val/commit/d2f385a04978992a5036379235e447ba7775faef)]:
  - @valbuild/ui@0.136.1
  - @valbuild/shared@0.136.1
  - @valbuild/core@0.136.1

## 0.136.0

### Minor Changes

- [#713](https://github.com/valbuild/val/pull/713) [`f3a4bb7`](https://github.com/valbuild/val/commit/f3a4bb7aea604943b92545c122243798c759715c) Thanks [@freekh](https://github.com/freekh)! - The Studio can load a bundler, and it stops telling a managed project that its
  publish is on its way out.

  **A managed project is one with no repository and no host watching one.** There
  is nothing outside the browser to pick a commit up, so the Studio has been
  showing it a story that belongs to a project with a repository: a `Building`
  spinner, waiting for an event that can never arrive. It does not resolve on a
  reload, on a retry, or tomorrow, and there is no way to tell it from a deploy
  that is merely slow.

  The content service now reports which kind of project this is, as `sourceMode`
  on `/stat`, and the Studio narrates accordingly:

  - a **connected** project keeps the deploy feed and keeps `Building`, because
    there a host genuinely does pick the commit up;
  - a **managed** one says `Saved, not yet live` instead — a durable condition,
    not a phase, because nothing else will ever resolve it.

  A server that reports no source mode keeps the behaviour it has today. Absence
  means "not reported", never "managed": `fs` mode has no project to have a mode,
  and neither does a content service that predates the field.

  **The Studio also loads `@valbuild/tanstack-build` in the tab**, at mount and at
  idle, for the managed projects that will need it — a browser that is the
  deployer needs a bundler. This is the groundwork for browser-side publishing;
  the publish path itself is unchanged in this release.

  That bundler is `@rolldown/browser`, whose WebAssembly binary is 10.9 MB and is
  **not** in the npm package. It is served from `static.val.build`, addressed by
  the SHA-256 of its own bytes, so the build and the binary it needs cannot drift
  apart. A deployment that must not reach that host — an air-gapped install, a
  mirror — sets `globalThis.__VAL_ROLLDOWN_WASM_URL__` before the Studio loads and
  needs no rebuild.

  **Building in the browser requires a cross-origin isolated page.** Rolldown runs
  WebAssembly on worker threads that share memory, and a browser will not hand a
  `SharedArrayBuffer` to a worker otherwise. Without
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` on the document Val is mounted in,
  loading the bundler now fails with a message that says exactly that, instead of
  a `DataCloneError` thrown from inside a worker. Nothing else in this release is
  affected: a Studio that never builds in the browser never asks.

### Patch Changes

- [#699](https://github.com/valbuild/val/pull/699) [`1d72d00`](https://github.com/valbuild/val/commit/1d72d00a1b036959ae0f1540121701cbb2694dcb) Thanks [@freekh](https://github.com/freekh)! - A `*.val.ts` with no default export is no longer reported as a missing module

  `*.val.ts` is a naming convention, not a promise: plenty of files under it hold
  only the schemas and helpers the modules beside them import. Every one of those
  was getting two errors in the editor — `Module '…' was not found in
val.modules` and `… is not registered in val.modules, so Val will not serve it`
  — both on line 1, telling their author to register a file that has nothing to
  register. `val validate` has never reported them; only the editor did.

  The default export is what makes a `*.val.ts` a module, so that is what the
  diagnostic now asks about:

  - **No default export → nothing is reported.** The file is not a module, so it
    is not a module Val is failing to serve.
  - **A default export → one diagnostic, on the `export default` itself** rather
    than on line 1, so it is next to the thing that has to change, and the
    duplicate fatal beside it is gone. The message now gives both remedies: add
    the file to `val.modules`, or export what it holds by name instead. The "Val:
    register … in val.modules" quick fix is offered there.

  The rule is `findDefaultExport` in `@valbuild/server`, which `val validate`
  already used to decide the same question — so the editor and the CLI now agree
  about which files are modules, including the cases that are easy to get wrong
  (`export * from …` carries no default; `export type { T as default }` and
  `export default interface T {}` are both gone after transpilation).

  Because the diagnostic now replaces a module's own findings rather than adding
  to them, the editor also stops guessing about registration it cannot read: a
  `val.modules` that registers modules through a tsconfig path alias
  (`import("_/content/page.val")`), or that builds its list in another file, is no
  longer taken to register nothing.

- Updated dependencies [[`f3a4bb7`](https://github.com/valbuild/val/commit/f3a4bb7aea604943b92545c122243798c759715c)]:
  - @valbuild/ui@0.136.0
  - @valbuild/core@0.136.0
  - @valbuild/shared@0.136.0

## 0.135.0

### Patch Changes

- [#707](https://github.com/valbuild/val/pull/707) [`c9affec`](https://github.com/valbuild/val/commit/c9affece6ae6ba62bd6c1113ed1fdab6317fa112) Thanks [@freekh](https://github.com/freekh)! - `val validate --fix` now formats with your prettier config instead of prettier's defaults

  `--fix` formatted the files it repaired by calling `prettier.format(code, { filepath })`, which never reads `.prettierrc`: `filepath` picks the parser and nothing else — only `resolveConfig`, `getFileInfo` and prettier's own CLI consult the config. On a project whose style is not prettier's default, a two-line content fix therefore arrived as a whole-file rewrite, and in a repo with a format check in CI it turned a content fix into a red build.

  There is now one implementation of "format a written file the way this project does", `createPrettierFormatter`, exported from `@valbuild/server` and re-exported by `@valbuild/next/server` and `@valbuild/tanstack/server`. It resolves `.prettierrc` for each file (including any `overrides` that match it), leaves anything in `.prettierignore` untouched, and falls back to prettier's defaults when the project has no config. `val validate --fix` uses it, so the CLI and the Studio can no longer disagree about formatting.

  Use it for your app's `formatter` too — this is the recommended setup, and it replaces reading `.prettierrc.json` by hand:

  ```ts
  import prettier from "prettier";
  import {
    initValServer,
    createPrettierFormatter,
  } from "@valbuild/next/server";

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

- [#706](https://github.com/valbuild/val/pull/706) [`72a7ca7`](https://github.com/valbuild/val/commit/72a7ca78354fff00e37a51359b17fba9334dc5e6) Thanks [@freekh](https://github.com/freekh)! - An endpoint that throws now answers Val's own 500 instead of the framework's.

  Nothing caught a throw from an endpoint implementation, so it left the Val
  router entirely and became whatever the host does with an unhandled error. On
  TanStack Start that is h3, which replaces the message with the literal string
  `"HTTPError"` and drops the stack — the same five words for a missing project,
  a bad cookie and a module that failed to link — and keeps the real cause on the
  server console. Where that console cannot be read (a Cloudflare Worker, for
  one), a Val server had no way to say what broke inside it.

  Such a request now answers Val's usual error envelope, naming the route, the
  method and the cause:

  ```json
  {
    "message": "Val: GET /authorize failed: Project is not set",
    "details": {
      "route": "/authorize",
      "method": "GET",
      "error": "Project is not set"
    }
  }
  ```

  The stack is logged rather than returned: `/authorize` and `/enable` are
  reachable without a session, and the message is the part a caller can act on.

## 0.134.1

### Patch Changes

- Updated dependencies [[`821e789`](https://github.com/valbuild/val/commit/821e789c1af47510af5d23eb96384ff78ddd7646)]:
  - @valbuild/shared@0.134.1
  - @valbuild/ui@0.134.0

## 0.134.0

### Patch Changes

- [#708](https://github.com/valbuild/val/pull/708) [`be78a9b`](https://github.com/valbuild/val/commit/be78a9b51678439f7ecb1c7f3887f9e8e1261a13) Thanks [@freekh](https://github.com/freekh)! - Fix `gitCommit` and `gitBranch` in `val.config.ts` never reaching the server,
  and make them the one way to say it.

  `val.config.ts` has had `gitCommit` and `gitBranch` for as long as it has had
  anything, and a deployed app that set them resolved to no repository at all.
  Nothing failed and nothing was logged: the commit was simply never sent, and
  every patch the project saved recorded none.

  ```ts
  // val.config.ts — the normal Vercel shape, and it did nothing
  initVal({
    project: "org/project",
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA,
    gitBranch: process.env.VERCEL_GIT_COMMIT_REF,
  });
  ```

  The two halves never met. The server wanted a nested
  `git: { commit, branch }`, `val.config.ts` offered two flat keys, and nothing
  mapped one onto the other — so the only thing that worked was
  `VAL_GIT_COMMIT` / `VAL_GIT_BRANCH` in the environment.

  Rather than teach the server to read both, the nested option is gone:
  `ValApiOptions` and TanStack's `ValHttpMode` now take `gitCommit` and
  `gitBranch`, the same two names `ValConfig` uses. There is one name for this
  now, wherever it is set. The framework bindings already hand the server
  `{ versions, ...config }`, so a project's config keys arrive with nothing to
  map, and a host passing them directly is saying the same thing in the same
  words.

  Flat because of where these values come from. A platform supplies them as
  `process.env.VERCEL_GIT_COMMIT_SHA` and friends, typed `string | undefined`,
  and two optional strings take that as it comes — a nested object makes every
  caller write the ternary that turns two maybe-strings into one maybe-object.

  **Breaking for a host that passed `git` itself**, which is the nested option on
  `ValApiOptions` and on TanStack's `http` mode. An app that only configures
  `val.config.ts` or the environment is unaffected.

  ```ts
  // before
  initValServer(valModules, config, {
    http: { apiKey, valSecret, git: { commit, branch } },
  });

  // after
  initValServer(valModules, config, {
    http: { apiKey, valSecret, gitCommit: commit, gitBranch: branch },
  });
  ```

  **What a commit is for**, and why its absence is worth a release rather than a
  shrug: publishing turns pending patches into new `.val.ts` text, and to patch a
  file you must first read it — at a commit. A project with none is a project
  whose publishes read whatever the content service last had, rather than the
  revision the deployed code was built from.

  **One more behaviour change.** A commit and a branch have always been taken
  together or not at all, and that check now sees config-supplied values too. A
  project that sets exactly one of `gitCommit` and `gitBranch` used to have both
  quietly ignored and will now be refused at startup, naming the missing half.
  That is the configuration that would otherwise fail later, at a publish.

- Updated dependencies [[`1c31dcc`](https://github.com/valbuild/val/commit/1c31dcca7f1bb0199350567fd579de29f48bb26d), [`688b9e3`](https://github.com/valbuild/val/commit/688b9e36b821323cda6870cdff03dd36ec3e782f), [`16c49ea`](https://github.com/valbuild/val/commit/16c49ea6dd97c7a96bbfdf211af9bab5884579e2), [`eaa265e`](https://github.com/valbuild/val/commit/eaa265e78d9f6d2a1b685c38901612b8a3704eed)]:
  - @valbuild/ui@0.134.0
  - @valbuild/core@0.134.0
  - @valbuild/shared@0.134.0

## 0.133.0

### Minor Changes

- [#700](https://github.com/valbuild/val/pull/700) [`802412b`](https://github.com/valbuild/val/commit/802412b92c06bc1abbca78c86885e39c8710dd83) Thanks [@freekh](https://github.com/freekh)! - http mode no longer needs a git repository

  A Val app can now run in http mode with no commit and no branch — its content
  service is the store of record, and git is an optional mirror of the code. This
  is what `fs` mode has always done: it has never had git, and it works.

  Before this, `VAL_API_KEY` and `VAL_SECRET` were not enough. `VAL_GIT_COMMIT`
  and `VAL_GIT_BRANCH` were required too, so a deployment with no commit to name
  either threw at boot or fell through to `fs` mode and reached for a working
  tree that was not there.

  **Breaking, if you pass `http` options in code.** `gitCommit` and `gitBranch`
  are replaced by one optional `git`:

  ```diff
   initValServer(valModules, config, {
     http: {
       apiKey,
       valSecret,
  -    gitCommit: process.env.VAL_GIT_COMMIT,
  -    gitBranch: "main",
  +    // Only for a project whose content is mirrored into a repository.
  +    // Omit it entirely otherwise.
  +    git: { commit: process.env.VAL_GIT_COMMIT, branch: "main" },
     },
   })
  ```

  `VAL_GIT_COMMIT` and `VAL_GIT_BRANCH` still work and are still read; they are
  simply no longer required. Set both or neither — a commit without a branch, or
  a branch without a commit, is refused at startup with a message naming the
  missing half, rather than failing later at a publish.

  **What a commit is for, where you have one.** Turning pending patches into new
  `.val.ts` text means reading the current text first, and that read goes to the
  content service at that commit. It is the publish path, not the serving path: a
  committed render reads the source compiled into the build and asks the content
  service nothing. With no repository there is nothing to write `.val.ts` into,
  so a publish records the module's data and its schema and skips the file — and
  that data is what history reads, so nothing is lost.

  **A publish can now be refused by name, before it is attempted.** If a project
  mirrors its commits into a repository but the running deployment was built
  before that repository existed, it has no commit to write the mirror against.
  Publishing anyway would save the content and silently leave the repository
  behind. The Studio now disables Publish and shows why, and `/save` refuses with
  a `no-base` code instead of failing partway.

  **Also:** `ValCommit` and `HistoricalCommit` have nullable `parentCommitSha`
  and `clientCommitSha`, and `/stat`'s `commitSha` is optional. A root commit has
  no parent, and a publisher with no repository does not report where it was. If
  you read these fields, handle `null`.

### Patch Changes

- Updated dependencies [[`2b9a51b`](https://github.com/valbuild/val/commit/2b9a51b7dbe2dff53b7686a4f3b7eb9bc5784fae), [`802412b`](https://github.com/valbuild/val/commit/802412b92c06bc1abbca78c86885e39c8710dd83)]:
  - @valbuild/ui@0.133.0
  - @valbuild/shared@0.133.0

## 0.132.1

### Patch Changes

- [#695](https://github.com/valbuild/val/pull/695) [`c07b1ab`](https://github.com/valbuild/val/commit/c07b1abe30e226c80ef7ec4b4f0f5ccdae061c11) Thanks [@freekh](https://github.com/freekh)! - A publish result can now say which commit it was built on, and what tree it points at

  `CommitResult` gains two optional fields, `parent` and `tree`, filled in from
  the content service's commit response when it reports them.

  Both matter to a host that keeps its own record of what each commit changed —
  a build cache, or an incremental publisher that rebuilds from the last thing it
  built rather than from scratch. Such a host can only tell whether its record is
  COMPLETE by chaining the commits it holds back to the one it last built. With
  just a sha per commit the record is a set of snapshots with no way to notice a
  gap, so a commit somebody else made in between is silently absent instead of
  detected — and the host rebuilds from a source tree that is missing a change it
  never knew about. `parent` is what closes that.

  `tree` identifies the CONTENT of a commit rather than the commit itself, so two
  commits carrying the same tree are the same source. A host that has already
  built one of them can recognise the other and skip the work.

  Both are optional, and absent means NOT REPORTED rather than absent-in-git: a
  content service that predates these fields sends neither, and a caller must not
  read a missing `parent` as "this is a root commit". They are plain strings
  rather than branded shas for the same reason — they are passed through as what
  a separately versioned service said, not as something this end has checked.

  Nothing changes for a host that does not look at them. The publish route's own
  response is unchanged.

- [#678](https://github.com/valbuild/val/pull/678) [`cbfa2b8`](https://github.com/valbuild/val/commit/cbfa2b884898f1603bde8e5aa5cd9da78778101f) Thanks [@freekh](https://github.com/freekh)! - Putting a whole module back works for `.jsonValues()` records

  A `.jsonValues()` record's entries are not in the module's source: the `.val.ts`
  holds `c.json(() => import("./entry.val.json"))` per entry and the content lives
  in those files. Val already routed a patch that named an entry key into the
  right file, but a patch that replaced the **whole record** named no key — so it
  was applied as an ordinary source edit, writing over the imports that make the
  entries load at all. "Put everything back" in the history pane left such a module
  out for exactly that reason.

  A whole-record write is now expanded into per-entry ops before anything acts on
  it: an entry added, one removed, one changed, and nothing at all for an entry
  that already holds what the write says — so putting a module back does not
  rewrite every file in it. The same expansion produces the draft the Studio shows
  and the files a publish writes, so a draft cannot show one thing and publish
  another.

  Nothing that writes a patch has to know a record is `.jsonValues()`: write the
  module as if it were ordinary content, and it lands in the right files.

  "Put everything back" and "Restore this whole module" now cover `.jsonValues()`
  modules. They read each entry as it was at the commit and put the content back —
  never the recorded source, which is markers rather than content, and is now
  refused rather than written.

- Updated dependencies [[`c9a5cd3`](https://github.com/valbuild/val/commit/c9a5cd3a4ab5908ecb9757b7a95db17a77e3b173), [`f413c5c`](https://github.com/valbuild/val/commit/f413c5cebca27ba82052825abc8c632b6177747e), [`1ddf245`](https://github.com/valbuild/val/commit/1ddf245ec73ad5af8099c3d18d4d33c6a1cc1254), [`a19997a`](https://github.com/valbuild/val/commit/a19997a542e65cc1375837b1bdb11c8af9e10160), [`76c5d41`](https://github.com/valbuild/val/commit/76c5d41c3afa7cc8180d156c9e19fb082af7fba4), [`cbfa2b8`](https://github.com/valbuild/val/commit/cbfa2b884898f1603bde8e5aa5cd9da78778101f), [`003419a`](https://github.com/valbuild/val/commit/003419ab72f3069d92e67dfea931d5accc63e730)]:
  - @valbuild/ui@0.132.1

## 0.132.0

### Minor Changes

- [#689](https://github.com/valbuild/val/pull/689) [`72cc676`](https://github.com/valbuild/val/commit/72cc6765e92a6e72b5c09ddd9eed8efa7ce899f2) Thanks [@freekh](https://github.com/freekh)! - `VAL_ENV=app` selects `http` mode.

  A host knows WHERE it is running; which Val mode that implies is Val's to
  derive. `VAL_ENV=app` says "this is the Val app" — a project built in a browser
  and served from a Worker isolate — and Val reads that as http mode: there is no
  disk, so `fs` is never the right fall-through, and the content is Val's own,
  read over HTTP at a commit like any other deployed app.

  Unlike `VAL_MODE=memory`, this **selects** the mode rather than only refusing a
  fall-through, because everything http mode needs is an environment variable. The
  point is what happens when one is missing: inference reads an absent
  `VAL_API_KEY` as "not a proxy" and resolves `fs` mode, which in an isolate fails
  on `.val/patches.lock` — a path, two layers below the actual mistake. Now each
  of `VAL_API_KEY`, `VAL_SECRET`, `VAL_PROJECT`, `VAL_GIT_COMMIT` and
  `VAL_GIT_BRANCH` is named when it is the one that is not set, and the message
  says which variable put the app in http mode.

  An explicit `VAL_MODE` still wins, including when it is a typo that has to be
  refused, and `http` is still not a value `VAL_MODE` accepts. A host that passes
  `sourceFiles` still gets memory mode: that is checked before the environment is
  consulted at all, so a build published by an older platform keeps working.

## 0.131.0

### Minor Changes

- [#686](https://github.com/valbuild/val/pull/686) [`0d5857b`](https://github.com/valbuild/val/commit/0d5857b731e11f7e6a011f79297df6485908c31f) Thanks [@freekh](https://github.com/freekh)! - Say `VAL_MODE=memory` where there is no disk, and get a sentence instead of an `EPERM`

  Memory mode — the one for a host that holds the project's source itself — is
  selected by passing `sourceFiles`, and it has to be: nothing in an environment
  can supply a project's source, so a mode that an env var could switch on would
  be a server with no content in it.

  The cost was the failure when a host forgot. Val inferred `fs` mode, `fs` mode
  went looking for a working tree, and in a Worker isolate the first thing to
  touch the disk failed:

  ```
  patch-error /bundle/.val/patches.lock: EPERM
  ```

  That names a path two layers below the decision that caused it, and nobody
  reading it would guess "your server was configured for the wrong mode".

  So an environment can now DECLARE that it has no disk:

  ```
  VAL_MODE=memory
  ```

  It does not turn memory mode on. It says the host is supposed to be supplying
  `sourceFiles`, so if none arrive, Val refuses at configuration time and says
  where to pass them. `VAL_MODE=` counts as unset, the way a shell means it; any
  other value is refused rather than ignored, since leaving you in `fs` mode is
  the exact failure this is meant to catch.

  **`initValContent` takes the same options, and this is the release that
  noticed.** It builds a Val server of its own — these readers resolve content by
  asking it, not by calling the API over HTTP — so configuring `initValServer`
  alone left them inferring `fs` mode. On a host with no filesystem that is a
  reader looking for a working tree that is not there; it went unnoticed because
  published reads still worked.

  ```ts
  const patchStore = new InMemoryPatchStore(); // now exported from this package

  const { valApiHandler, draftMode } = initValServer(valModules, config, {
    sourceFiles: FILES,
    patchStore,
    unsafelyAllowUnauthenticated: true,
  });

  const { fetchValStega } = initValContent(config, valModules, {
    draftMode,
    // The same three. Two patch stores are two sets of pending edits, and a
    // reader that checks a session the host never issues answers itself 401 and
    // falls back to published content — a draft render showing the live site.
    sourceFiles: FILES,
    patchStore,
    unsafelyAllowUnauthenticated: true,
  });
  ```

  All three are optional. Left out, this reader gets its own store and its own
  answer about authentication, which is right for published content.

  `@valbuild/next` has no memory mode: its `initValServer` takes neither option,
  so for a Next app `VAL_MODE=memory` names an environment Val cannot serve from,
  and the error says so.

  Nothing changes for an app that sets none of this: `http` when `VAL_API_KEY`
  and `VAL_SECRET` are both present, `fs` otherwise, as before.

## 0.130.0

### Minor Changes

- [#684](https://github.com/valbuild/val/pull/684) [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75) Thanks [@freekh](https://github.com/freekh)! - A third ValOps mode, for a host that already holds its own source

  EXPERIMENTAL. `fs` mode assumes a working tree it can watch and write; `http`
  mode assumes Val's content service owns the patch chain and that a commit is a
  git commit. A host that builds and publishes its own output is neither: it holds
  the source already, it has nowhere to watch, and its "commit" is a new build.

  Forcing such a host into `fs` mode cost three things, all now fixed: `/stat`
  long-polled against watchers that could never fire, burning CPU for the whole
  hold to learn nothing;
  `/api/val/enable` 500'd; and every read of a `.val.ts` went through a shimmed
  filesystem when the host could simply hand the source over.

  `ValOpsMemory` takes the source as `sourceFiles`, refuses the local binary
  members by name — this configuration uses Val's remote files — and answers the
  history members with the same closed `not-supported-in-fs-mode` error `ValOpsFS`
  gives, so the History UI degrades the way it already knows how rather than
  inventing a commit list.

  `getStat` still long-polls -- the hold is what paces the client, and an earlier
  version that answered immediately turned a 20-second poll into a request every
  6ms -- but it parks on a SIGNAL rather than a timer. This mode owns its store,
  so it is told when something changes: no timers while parked, and a patch
  written by another tab is seen at once rather than up to 250ms later.

  Two seams come with it. `commitPrepared` lets a host take what a save produced
  instead of a git commit, and `publishOverride` lets a publish be something other
  than a push. Both are opt-in; an app that sets neither behaves exactly as before.

  The in-memory patch store is explicitly **not durable**. It is behind
  `ValPatchStore`, so a durable implementation is a swap rather than a rewrite,
  but as shipped a restart loses unpublished patches.

  **Memory mode authenticates.** `ValOps` gained `requiresAuth` alongside
  `patchesAreLocal`, because one flag was answering two questions: whether a store
  auto-saves or publishes (behaviour, reported as `mode` and keyed off by the UI),
  and whether an unauthenticated request may write (security). With two
  implementations the answers coincided — `fs` is a developer's own machine where
  no credential exists, `http` is remote — so `getAuth` was written against
  `patchesAreLocal` and returned anonymous _success_ for a missing cookie, an
  invalid JWT, an unparseable payload, or no configured secret.

  Memory mode splits them: its store is local, and it runs deployed. It therefore
  requires a verified session, like `http` mode. A host that authorises requests
  before Val sees them can opt out with `unsafelyAllowUnauthenticated`, which is
  spelled that way on purpose and warns at startup. `fs` mode is unchanged.

  Val's own MCP endpoint refuses memory mode outright. It has the same absence fs
  mode has — no credential, no backend, every permission check on the far side of
  one — and unlike fs mode it is meant to run deployed, so the existing
  "development only" and loopback guards refuse nothing. A host in this mode owns
  its own trust boundary and can offer the tools through it.

  Internally, the routes' `instanceof ValOpsFS` checks meant "is this a local
  store" — correct with two implementations and silently wrong with three. They are
  now `ValOps.patchesAreLocal` at all 17 policy sites.

### Patch Changes

- [#684](https://github.com/valbuild/val/pull/684) [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75) Thanks [@freekh](https://github.com/freekh)! - Stop telling people to run `val login` where a personal access token cannot be used

  A PAT is read from a file in the _server's_ working directory, and only local
  `fs` mode has one. `resolveRemoteFileAuth` knew that; two things upstream did not.

  `RemoteFilesErrorDialog` was unconditional. Whatever went wrong with remote files,
  it said "Personal access token file required" and told the reader to run a command
  in their project root — for a server with no working directory, a directory that
  does not exist, to produce a file it could not read. The reason was already on the
  error object and simply never looked at. The dialog now shows only for the two
  reasons a PAT can actually fix, and everything else gets its own message.

  `resolveRemoteFileAuth` also answered `project-not-configured` for a non-fs mode
  with no api key, which is wrong twice: the project may be configured perfectly
  well, and it is the credential that is absent. It answers `api-key-missing` now,
  already in the wire contract, and that message no longer says "production mode",
  because every server that is not local dev gives it.

- [#684](https://github.com/valbuild/val/pull/684) [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75) Thanks [@freekh](https://github.com/freekh)! - `createValApiRouter` no longer puts `fs` in every integration's module graph

  `fs` and `path` were imported at module scope for `safeReadGit`, a local
  development convenience that scans upwards for a `.git` to guess the commit and
  branch, and whose only caller is the CLI. A static import put `fs` in the module
  graph of everything reaching `createValApiRouter` — which is every server
  integration, including ones that run where there is no filesystem at all.

  Behaviour is unchanged where there is a filesystem.

- Updated dependencies [[`be1e8be`](https://github.com/valbuild/val/commit/be1e8bee673207596b3eb3d9a9886b8ade9b332f), [`8425378`](https://github.com/valbuild/val/commit/8425378c315ea46b5d822f1130b633e0449ff1b0), [`7d13dbc`](https://github.com/valbuild/val/commit/7d13dbced9ea49d8243b6b6cf9854cd1a259501f), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`07db94c`](https://github.com/valbuild/val/commit/07db94c23b73c8c0b2b50a30a89926823c2da1d6), [`473a185`](https://github.com/valbuild/val/commit/473a185f70351b44388f3bc1852649e2c1dbe001), [`64f0de3`](https://github.com/valbuild/val/commit/64f0de339b8621cb5a6c422dfe55cae5b2bbe2a0)]:
  - @valbuild/ui@0.130.0
  - @valbuild/core@0.130.0
  - @valbuild/shared@0.130.0

## 0.129.0

### Patch Changes

- Updated dependencies [[`e20f6fb`](https://github.com/valbuild/val/commit/e20f6fbcc215c310eef49a44c1a592c1e2081613), [`7d34ecc`](https://github.com/valbuild/val/commit/7d34ecce787a0709025ae7b4764cb6c3ad1f766b), [`0c351c4`](https://github.com/valbuild/val/commit/0c351c4f97ae7f09772eab0e856ae69821b803b7), [`41a0d76`](https://github.com/valbuild/val/commit/41a0d76636a2dce3f1e506d93170d97e46041d98), [`9e0ebb0`](https://github.com/valbuild/val/commit/9e0ebb00430f05ef92dff031309f73b8075a7d99)]:
  - @valbuild/ui@0.129.0
  - @valbuild/core@0.129.0
  - @valbuild/shared@0.129.0

## 0.128.0

### Patch Changes

- Updated dependencies [[`8b52b33`](https://github.com/valbuild/val/commit/8b52b33e1f629f14f66cc71dcc7cf415d210c7d4), [`362fb49`](https://github.com/valbuild/val/commit/362fb49f30d2b04c4ff78d54dca2bf5ad978a05c), [`c595799`](https://github.com/valbuild/val/commit/c59579977a436ec530c6c69f2b340ab9829d97ab)]:
  - @valbuild/core@0.128.0
  - @valbuild/shared@0.128.0
  - @valbuild/ui@0.127.0

## 0.127.0

### Minor Changes

- [#608](https://github.com/valbuild/val/pull/608) [`7fa8699`](https://github.com/valbuild/val/commit/7fa869974bc895af992a7d5c18b76253636d7d65) Thanks [@freekh](https://github.com/freekh)! - A record whose schema declares its keys now holds every one of them.

  Two key schemas enumerate their keys: `s.locale()`, whose set is the project's
  `locales.available`, and a union of literals. For those, the keys are part of the
  schema, so a missing one is a hole in the content rather than content nobody has
  written yet — and validation now says so, naming what is missing.

  ```typescript
  s.record(s.locale(), s.object({ title: s.string() }));
  // Missing key: 'nb-NO'. This record's keys are declared by its schema, so
  // every one of them is an entry — an entry nobody has written yet is null,
  // not absent.
  ```

  **An entry nobody has written yet is `null`.** Not an absent key: a null entry is
  data you can count, filter and see in a diff, and it means half-translated
  content stays _valid_ rather than blocking a publish. The value type of such a
  record widens by `null` to match, so writing one in a `.val.ts` type-checks:

  ```typescript
  c.define(
    "/content/jacket.val.ts",
    s.record(s.locale(), s.object({ title: s.string() })),
    {
      "en-US": { title: "Winter jacket" },
      "nb-NO": null, // nobody has translated this yet
    },
  );
  ```

  **This changes `s.record(s.union(...), item)`**, and closes a gap that was
  already there: `s.record(s.union(s.literal("a"), s.literal("b")), item)` types as
  `Record<"a" | "b", T>`, so TypeScript demanded both keys while the validator only
  checked the ones present. It now checks them too, and — as above — accepts `null`
  for an entry that has not been filled in. If you have such a record with keys
  missing, validation will report them; adding the keys with `null` values is the
  fix, and creating one from the Studio does it for you.

  `emptyOf` creates these records with every key already in them rather than
  empty, since an empty one is already missing keys. In the Studio use the
  `useEmptyOf()` hook rather than importing `emptyOf` directly: a locale record's
  keys are in the settings module, and the hook is what has read it.

- [#608](https://github.com/valbuild/val/pull/608) [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63) Thanks [@freekh](https://github.com/freekh)! - `s.locale()`: one of the project's languages.

  The languages themselves are declared in the settings module (`locales.available`);
  this says that a value is one of them.

  ```typescript
  // a field: everything in this entry is in this language
  s.record(s.string(), s.object({ locale: s.locale(), title: s.string() }));

  // a key: one entry per language
  s.record(s.locale(), s.object({ title: s.string() }));
  ```

  Every locale in content is checked against the project's list, the way `keyOf`
  and `route` are checked against what they point at. An undeclared language names
  the ones the project has; a project that has declared none is told to declare
  them rather than told the value is wrong.

  A locale is stored as the tag itself — the value in content is `nb-NO`, and a
  record keyed by `s.locale()` has `nb-NO` as its key. Spelling one differently
  where it is stored (`/no/…` as a URL segment) is a real need and is deliberately
  not in this release: it changes what is accepted as well as what is shown, so it
  is being designed on its own rather than folded in here.

  A locale is **never stega encoded**: it ends up in `<html lang>`, in `hreflang`
  and in `Intl` constructors, none of which survive invisible characters.

  `assistant.translation` joins the settings module alongside `context` and `tone`
  — a note per language, keyed by language, so only the target language's rules are
  sent when translating into it.

### Patch Changes

- Updated dependencies [[`7fa8699`](https://github.com/valbuild/val/commit/7fa869974bc895af992a7d5c18b76253636d7d65), [`600308d`](https://github.com/valbuild/val/commit/600308d0174990ad9f5c417147d160273489c65a), [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63), [`88262ac`](https://github.com/valbuild/val/commit/88262ac8db068650a664981ef73556457d87741a), [`7072e07`](https://github.com/valbuild/val/commit/7072e07623c953a09ac14388ae22dada0b431ce3), [`29811c3`](https://github.com/valbuild/val/commit/29811c3f8c7e001a950e6f4833af6888e6a4efea), [`9983116`](https://github.com/valbuild/val/commit/99831164c5151aad7ca69de79e1d0d59878be251)]:
  - @valbuild/core@0.127.0
  - @valbuild/shared@0.127.0
  - @valbuild/ui@0.127.0

## 0.126.0

### Patch Changes

- [#664](https://github.com/valbuild/val/pull/664) [`5bfd630`](https://github.com/valbuild/val/commit/5bfd630b63dee2189e238f20fe72ecc5537160f7) Thanks [@freekh](https://github.com/freekh)! - Show the git message on deployments Val did not publish

  The deploy feed could only name a publish when Val itself had made the commit:
  the message came off Val's own `ValCommit`, and every other deployment — a
  developer's push, a merged pull request, a revert — showed a seven-character
  sha. On most projects those are the majority, so "what went out at 14:02?" had
  no answer in the Studio.

  A deployment can now carry its own `commitMessage`, which the Studio uses
  wherever there is no Val commit to prefer. It is optional and nullable, so a
  content service that does not report messages is unaffected — those publishes
  keep showing the short sha, exactly as before.

  Deployment rows also show only the subject line of a message now. A git message
  is a subject, a blank line and a body, and the rows are one truncated line — so
  a real push arrived as "Subject The body went on like this…". The classic
  Draft changes view still has the whole message in its tooltip.

- [#652](https://github.com/valbuild/val/pull/652) [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a) Thanks [@freekh](https://github.com/freekh)! - `s.union` is now `s.discriminatedUnion` and `s.enum`.

  `s.union` did two unrelated jobs and worked out which one you meant from its
  first argument: a string key meant a tagged union of objects, literal schemas
  meant a set of allowed strings. Those are now two schemas with two names.

  ```ts
  // A fixed set of strings — presents as a dropdown
  s.enum("primary", "secondary", "ghost"); // Schema<"primary" | "secondary" | "ghost">

  // One of several object shapes, told apart by a tag field
  s.discriminatedUnion(
    "type",
    s.object({ type: s.literal("hero"), heading: s.string() }),
    s.object({ type: s.literal("quote"), text: s.string() }),
  );
  ```

  `s.enum` takes the strings directly, so the `s.literal(...)` wrapper is gone.

  **`s.union` still works** — it is deprecated, and it builds exactly the schema
  above, so nothing has to change today:

  ```ts
  s.union(s.literal("one"), s.literal("two")); // → s.enum("one", "two")
  s.union("type", pageA, pageB); // → s.discriminatedUnion("type", pageA, pageB)
  ```

  The two are different kinds of node, and that is the reason for the split. A
  discriminated union is a container: the selected variant's fields are the fields
  being edited, and everything that walks a schema descends through it. An enum is
  a leaf — a string with a closed domain — so nothing recurses into it. Told apart
  only by the shape of `key`, every consumer had to re-derive which one it was
  holding; each now has its own serialized type (`"discriminated-union"` and
  `"enum"`) and Val Studio has a field per kind rather than one field that
  branches.

  Two behaviour changes fall out of the split, both of them fixes:

  - A value that is not a string at all now fails an enum's validation with a
    type error. `s.union` of literals only ever checked the value against its
    literals when the value WAS a string, so a number or an object where an enum
    was declared validated clean.
  - An enum field now shows its validation errors in Val Studio where the field
    is opened on its own — the module editor and the canvas's fields column — and
    gets the compact error layout inside an inline list row. It is a leaf now, so
    it goes through the same error rendering as every other leaf field; the string
    union bypassed it and showed nothing in those places.

  Several latent crashes in the old `s.union` are fixed on the way past, all of
  them cases where it threw a `TypeError` instead of reporting:

  - A required discriminated union holding `null` now reports a type error rather
    than throwing, and resolving a path underneath a nullable one that is `null`
    gives the error the API promises instead of a crash.
  - `s.literal("")` is a legal discriminator tag, and `s.enum("")` a legal value.
    Both used to be treated as absent by a truthiness check — in path resolution,
    in stega encoding, and in the message that lists a union's valid tags. The
    editor's dropdowns handle them too: an empty value is reserved by the select
    component and had to be mapped around.
  - A variant that omits the discriminator entirely is now reported as the schema
    error it is, instead of throwing while the check looked for it.
  - An enum's value is now indexed for search, like every other string leaf. The
    old string union was never indexed at all, so searching for one of its values
    could not find the field.
  - A nullable discriminated union set to `null` no longer renders a spinner that
    never resolves.

  `s.discriminatedUnion` also requires at least one variant, as `s.enum` requires
  at least one value: a union with nothing to select is not a thing to write, and
  everything downstream reads the first variant where it needs any.

  If you read serialized schemas yourself, that is the breaking part: `type` is no
  longer `"union"`, an enum carries `values: string[]` instead of a `key` plus
  `items` of literal schemas, and `UnionSchema` is no longer a class.
  `SerializedUnionSchema`, `SerializedStringUnionSchema`,
  `SerializedObjectUnionSchema` and `UnionSchema` remain as deprecated type
  aliases.

- [#666](https://github.com/valbuild/val/pull/666) [`5c18c99`](https://github.com/valbuild/val/commit/5c18c99ecc84651f82123481fc042063db953833) Thanks [@freekh](https://github.com/freekh)! - `next build` no longer warns `module.createRequire failed parsing argument.`

  Every Next app that bundles `@valbuild/server` into its Val API route got this
  on every build, twice, with an import trace that led from `route.ts` down into
  `valbuild-server.esm.js` and stopped there:

  ```
  ⚠ ./node_modules/.../@valbuild/server/dist/valbuild-server.esm.js
  module.createRequire failed parsing argument.
  ```

  Nothing was wrong. webpack special-cases a `createRequire` binding imported from
  `node:module` and tries to resolve the call's argument at build time; the two
  calls in this package take a path inside the user's project, known only at
  runtime, so there was nothing to resolve and nothing the warning could tell
  anyone. Both now go through a helper that reaches the same function through the
  `Module` class, which that analysis does not tag. Runtime behaviour is
  unchanged, and a lint rule keeps the direct import from coming back.

- Updated dependencies [[`719ad6b`](https://github.com/valbuild/val/commit/719ad6b607bcf136d0dbde9e90bf4b8a843561a4), [`9830277`](https://github.com/valbuild/val/commit/9830277e9aaca8da3030f629c2656ec58da47e45), [`64bfd0a`](https://github.com/valbuild/val/commit/64bfd0a6c85832ea5169b53e47087f22e193df36), [`7782979`](https://github.com/valbuild/val/commit/7782979e9b52f2015a6e72dc981e630d4f8c78e2), [`5bfd630`](https://github.com/valbuild/val/commit/5bfd630b63dee2189e238f20fe72ecc5537160f7), [`ccbcda6`](https://github.com/valbuild/val/commit/ccbcda60b3e3c465071229ae1ba28ac735483e63), [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a), [`755e1a3`](https://github.com/valbuild/val/commit/755e1a3953775cb8d2c2dce87d6810d3dc329640), [`c6b1ec8`](https://github.com/valbuild/val/commit/c6b1ec84f1883750a4cfe5f70470b177621e971f), [`656f680`](https://github.com/valbuild/val/commit/656f680043c640f678625a64e690389ab23a0a69), [`610a041`](https://github.com/valbuild/val/commit/610a0414b120b521f38a2eb1182b3778bf778b2b), [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f)]:
  - @valbuild/ui@0.126.0
  - @valbuild/shared@0.126.0
  - @valbuild/core@0.126.0

## 0.125.0

### Patch Changes

- Updated dependencies [[`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90)]:
  - @valbuild/core@0.125.0
  - @valbuild/shared@0.125.0
  - @valbuild/ui@0.125.0

## 0.124.0

### Minor Changes

- [#639](https://github.com/valbuild/val/pull/639) [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055) Thanks [@freekh](https://github.com/freekh)! - Show `.jsonValues()` entries in the history pane

  A `.jsonValues()` record keeps each entry's content in its own `*.val.json`
  file; the module's own content is just markers pointing at them. The history
  pane had no way to fetch those files for a past commit, so every entry rendered
  as an **empty field** — which reads as "the author left this blank", about
  content that was simply stored somewhere else.

  Entries now load in the history pane the same way they load in the Studio: one
  at a time, when you open one. A commit with a thousand support pages costs
  nothing until you look at one of them.

  An entry that cannot be read says so instead of rendering blank — including the
  case where the key did not exist yet at that commit, which is a real answer
  rather than an error.

### Patch Changes

- [#639](https://github.com/valbuild/val/pull/639) [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055) Thanks [@freekh](https://github.com/freekh)! - Require a session to read a file from history

  `GET /api/val/history/files` served a file at a given commit to anyone who
  asked. It followed the reasoning of `/api/val/files`, which is deliberately
  open — and neither half of that reasoning applies to it:

  - `/files` stands on `patch_id` being an unguessable UUID. A **commit sha is
    published** — `git log`, the GitHub UI, every pull request — so it is no
    substitute for a credential.
  - `/files` also _cannot_ require auth: draft images are fetched by the app's own
    backend during Next image optimisation, with no cookies to send. Nothing
    fetches history files server-side; both callers are the Studio, in a browser
    that already holds the session.

  So history files now require a session. `/files` is unchanged, and the reason
  the two differ is written down in `architecture/media.md` so it is not "fixed"
  in either direction later.

  No action needed: the Studio sends its session cookie automatically.

- Updated dependencies [[`5674237`](https://github.com/valbuild/val/commit/56742371a75b4fdcbff8b1afccff8fcc1ebf8078), [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055), [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055), [`aa89fc2`](https://github.com/valbuild/val/commit/aa89fc26de7028b3c5a1666b99afc03b39e92769)]:
  - @valbuild/ui@0.124.0
  - @valbuild/shared@0.124.0
  - @valbuild/core@0.124.0

## 0.123.3

### Patch Changes

- [#623](https://github.com/valbuild/val/pull/623) [`4c9369b`](https://github.com/valbuild/val/commit/4c9369bad3f17e96868262e78a4f47361d85319e) Thanks [@freekh](https://github.com/freekh)! - Add the editor quick fix for a `.jsonValues()` entry written inline: **Val: move entry into its own .val.json**.

  The language server already reported the problem — "Entry '…' is written inline … Run 'val validate --fix' to move it" — but offered no way to act on it, so the only remedy was to leave the editor and run the CLI. It now offers a quick fix that creates the `*.val.json` with the entry's content and rewrites the `.val.ts` to `c.json(() => import("./…"))`, in one undoable step.

  The fix is computed from the same code `val validate --fix` runs, so the two write the same files, and it is computed against the buffer you are looking at rather than what is on disk — an unsaved module can be fixed without saving first. It refuses, rather than overwriting, when a file or an unsaved buffer already occupies the target path.

  Requires an editor that honours file creation inside a workspace edit; VS Code does. In an editor that does not announce it, no action is offered rather than one that would rewrite the module to import a file that never got created.

- [#621](https://github.com/valbuild/val/pull/621) [`fb1baff`](https://github.com/valbuild/val/commit/fb1baffead5228d8a86a51af65178b88738d5a64) Thanks [@freekh](https://github.com/freekh)! - Fix `.jsonValues()` validation being silently skipped when the CLI is run through `npx` / `pnpm dlx`.

  `npx @valbuild/cli validate` reported a `.jsonValues()` module whose entries were still written inline in the `.val.ts` as **valid**, and `--fix` moved nothing into `*.val.json`. Running the CLI installed in the project (`./node_modules/.bin/val validate --fix`) worked, which made this look like a schema or path problem rather than a tooling one.

  The cause: the project's `*.val.ts` are evaluated with a `require` rooted at the project, so their schemas come from the project's `@valbuild/core`, while `npx`/`dlx` runs the CLI's own second copy. The entry check guarded on `schema instanceof RecordSchema`, which is false across those two copies, and it failed open — the whole check returned "no errors". The guard is now structural, so it holds whichever copy built the schema. If you gate CI on `npx @valbuild/cli validate`, that gate was green for the wrong reason.

- Updated dependencies [[`accf4f8`](https://github.com/valbuild/val/commit/accf4f852fe3400d762cc14e80316da741a69a9a), [`356eb11`](https://github.com/valbuild/val/commit/356eb11b5f6a0a02dfec80580c6fccac75d28402), [`aef45ce`](https://github.com/valbuild/val/commit/aef45ce3ef269f1b6221de44a56df0f6a0d9dbbd)]:
  - @valbuild/shared@0.123.3
  - @valbuild/ui@0.123.3

## 0.123.2

### Patch Changes

- [#619](https://github.com/valbuild/val/pull/619) [`8e58c34`](https://github.com/valbuild/val/commit/8e58c3495d1bf0f221a57082cb0a3045929722a1) Thanks [@freekh](https://github.com/freekh)! - Stop `val validate` reporting published remote gallery images as missing — and `--fix` deleting them

  A remote gallery (`s.images({ remote: true })`) keys an uploaded entry by its
  remote URL. Two separate checks read that key, normalised it back to the local
  path it encodes, and then required a file to be sitting there:

  - `val validate` reported _"Gallery … has tracked files that do not exist on
    disk"_ for every published remote image;
  - `val validate --fix` **removed the entry from the gallery**, silently deleting
    the reference to a file that was safely on the content host.

  Both were wrong for the same reason. Publishing uploads remote files to the
  content host and copies only local ones into the working tree, so an image added
  through the Studio — or over MCP — has no file in the repo by design. Putting one
  there is exactly what remote storage exists to avoid.

  Remote entries are now exempt from both the missing-file check and the
  metadata-from-disk verification. Whether a remote entry is sound is
  `image:check-remote`'s question, and it already asks it. Nothing changes for
  local entries, or for a remote entry that does have a local file — `--fix`
  promotes a local file to a remote ref and leaves the file where it was, and that
  file is still counted as tracked rather than reported as untracked.

- Updated dependencies [[`04b6d4c`](https://github.com/valbuild/val/commit/04b6d4cbbecc131bbaf3c20633af9dad8c857310), [`3e93508`](https://github.com/valbuild/val/commit/3e93508b05d08b0c24947a97c6141a9ad8a3931e)]:
  - @valbuild/shared@0.123.2
  - @valbuild/ui@0.123.2

## 0.123.0

### Minor Changes

- [#613](https://github.com/valbuild/val/pull/613) [`c5e7dfd`](https://github.com/valbuild/val/commit/c5e7dfd12aa1371195be642e1c2fb72b6f3e3ce2) Thanks [@freekh](https://github.com/freekh)! - Val's MCP endpoint moves to its own package, and can now upload images

  Everything that serves Val's content tools over MCP — the tool registry, the
  write path behind it, the request guards and the access-token verification —
  now lives in **`@valbuild/mcp`** instead of being split between
  `@valbuild/server` and `@valbuild/next`.

  **Nothing changes for an app that already mounts it.** `initValMcp` is still
  exported from `@valbuild/next/server` and behaves exactly as before; it is now a
  ten-line binding over `@valbuild/mcp`, supplying the Next version that
  `initHandlerOptions` asks for. A host that is not Next can call
  `initValMcp` from `@valbuild/mcp` directly.

  If you built your own host on `createValTools`, import it from `@valbuild/mcp`
  rather than `@valbuild/server`; the tool types moved with it.

  ## Image uploads

  An agent can now add an image, with a new `upload_image` tool. It takes a path
  to a file on the machine your app runs on, or the image inline as base64, and
  puts it in an `s.image()` field or an `s.images()` gallery.

  Uploads are converted **only where the Studio would convert them**: `encode` is
  off unless the schema asks for it (`s.image({ encode: { type: "webp" } })`), and
  when it does, which images are converted, how far they are scaled and when the
  original wins are the same decisions the browser makes — the same code, now
  shared. An upload to a schema without `encode` is stored exactly as it arrived,
  whatever its size.

  One thing the tool does that the Studio does not: it refuses an image the
  schema's `accept` does not cover, checked on the bytes that would actually be
  stored. The Studio does not need to — its file picker carries `accept` — and
  validation reports a mismatch as server-repairable, so nothing downstream would
  stop it. An agent has no picker. Note the ordering:
  `s.image({ accept: "image/webp", encode: { type: "webp" } })` still takes a PNG,
  because the conversion happens first and it is the result that is checked.

  It is the one tool you construct yourself, because it needs an image library
  and `sharp` ships a compiled binary per platform. Val does not put one in every
  project that installs it, so you decide:

  ```sh
  npm install sharp
  ```

  ```ts
  import sharp from "sharp";
  import { createValImageTools } from "@valbuild/mcp";
  import { sharpImageProcessor } from "@valbuild/mcp/sharp";

  const { valMcpAuthorize, valMcpTools } = initValMcp(valModules, config, {
    extraTools: createValImageTools(sharpImageProcessor(sharp)),
  });
  ```

  Leave `extraTools` out and everything else works as before — the agent can read,
  validate and edit content, it just cannot add an image. `sharp` is passed in
  rather than imported, so you can supply another encoder: `ValImageProcessor` is
  two functions, `read` and `encode`.

  Remotely stored images work too — `s.image().remote()` and
  `s.images({ remote: true })` — and they need nothing extra from the MCP client.
  Adding one does not upload anything to Val's content host: the bytes go into the
  patch store like any other unpublished change, and the push to
  `remote.val.build` happens when you publish, exactly as it does for an image
  added through the Studio. All the tool has to do first is ask the project which
  bucket to name in the ref, and the credential for that is the one your app
  already has — its API key when it has one, and in local development the
  `val login` token in your project, the same one `val validate --fix` uses. If
  you have not logged in, it says so and writes nothing.

  ## `npm create @valbuild` asks

  The starter template now ships the MCP endpoint, and `npm create @valbuild`
  asks whether you want it — and, if you do, whether agents should be able to
  upload images, saying that this adds `sharp`. Both default to yes, and both can
  be answered up front for a scripted setup:

  ```sh
  pnpm create @valbuild my-app --mcp --no-image-uploads
  ```

### Patch Changes

- Updated dependencies [[`c5e7dfd`](https://github.com/valbuild/val/commit/c5e7dfd12aa1371195be642e1c2fb72b6f3e3ce2), [`53f670c`](https://github.com/valbuild/val/commit/53f670c0cf2d7a03a6d068c78b7874ce77652c2a)]:
  - @valbuild/shared@0.123.0
  - @valbuild/ui@0.123.0

## 0.122.0

### Minor Changes

- [#563](https://github.com/valbuild/val/pull/563) [`be32261`](https://github.com/valbuild/val/commit/be32261af19db8018bc37b180d903416018c0b79) Thanks [@freekh](https://github.com/freekh)! - See how a module looked at any past commit, and restore from it by pointing at it

  Val could publish edits but never look back. Now every commit is a durable
  record you can open, and any part of it can be put back.

  **Open a commit and the Studio splits in two.** The left half is the Studio
  itself — same navigation, same fields, same everything, because it _is_ the
  editor rather than a copy of it. The right half shows the project as that commit
  left it. On a phone the two become one pane and a toggle.

  **Restoring is directed: you point at the old value, then at where it goes.**
  Val does not try to work out which of today's fields corresponds to which of the
  commit's. It cannot be sure — array items splice, schemas move — and a restore
  that guesses wrong writes into the wrong place and looks like it worked. Two
  picks leave nothing to guess. You can restore across paths, so last month's
  headline can become today's tagline.

  Before you click, every field on the "now" side says whether it can hold the
  value you picked, and a field that cannot explains why when you click it rather
  than doing nothing. A changed union is not itself a blocker: what matters is
  whether the value's own shape is still allowed, so a union that gained a case
  restores fine and one that lost the case you are restoring does not.

  Rich text can be restored but is marked "probably fits" rather than confirmed —
  comparing every mark and block against the options a schema allows is not done
  yet, and saying so is better than a confident answer we cannot back. It is
  checked properly the moment you commit to it: before anything is staged, the old
  value is checked against the field it is going into, and a value that cannot be
  that field is refused with the reason. A value that is the right shape but
  breaks a rule about its content — a name too short for its `minLength` — is
  staged and then held at publish, the same as if you had typed it, because a
  restore should not be stricter than typing.

  **A whole module can be put back on its own**, from a commit that changed
  several, without reverting the rest of the commit.

  **Restores are staged, not applied.** They land in pending changes, are reviewed
  beside every other edit, and go out with the next publish. There is also "put
  everything back", for when a whole publish was the mistake.

  To make this possible, publishing now records each changed module's data and the
  schema it was written against. Not the `.val.ts` — git already keeps that, but
  it is code, and turning code back into data means parsing it, which is
  best-effort and stops working as TypeScript, your runtime and Val move on. The
  schema is kept because a value on its own cannot be drawn: showing a module as it
  was at a commit whose schema has since changed needs _that commit's_ schema, and
  nothing in your current checkout has it.

  Things it will not pretend about: a module the commit did not touch says so
  rather than showing today's value; a module saved by a different version of Val
  says the version differs and that nothing is lost; a commit made before Val
  started recording history disables restore with the reason next to it. Images
  and files are restored by re-uploading them, since the bytes at an old commit
  may no longer be on your branch.

  History requires the Val content service. In filesystem mode it reports
  `not-supported-in-fs-mode` rather than faking it from git, which has the files
  but not which of a commit's changes were one editor's work.

- [#597](https://github.com/valbuild/val/pull/597) [`5d14612`](https://github.com/valbuild/val/commit/5d14612f612d657a37338136188f2b3c02b28fe7) Thanks [@freekh](https://github.com/freekh)! - MCP: remove personal access token auth. The endpoint now needs an `oauth`
  config, or local filesystem mode.

  Until now, an MCP endpoint with no `oauth` config accepted whatever bearer token
  a caller presented and relayed it to the Val content backend unread. The
  reasoning was that without an issuer the app has no key to check a token
  against, so it should not pretend to be the authority on what that token may
  do — and that much was right. The shape was not: a credential the app cannot
  check is one it cannot refuse either, so "a deployed endpoint that authenticates
  nobody" was a supported configuration, and an app could serve content-rewriting
  tools without ever being told where its callers should authorize.

  **If you run Val in proxy mode**, MCP now requires the `oauth` config that
  shipped in `0.120.0`. Callers authorize as themselves against the Val
  authorization server, this app verifies the token's signature, issuer, audience
  and expiry itself, and patches carry the verified profile as their author:

  ```ts
  initValMcp(valModules, config, {
    oauth: {
      issuer: "https://admin.val.build",
      resource: "https://your-app.com/api/mcp",
    },
  });
  ```

  Leave it out and the endpoint answers `500` naming the missing config, rather
  than serving the request.

  **If you run Val in local filesystem mode**, nothing changes. Local development
  still needs no `oauth` config and no authorization server: there is no backend
  to authenticate to, and patches are written with no author. A token presented
  to such a project is still refused rather than ignored — the endpoint answers
  `400` and says to take the credential out of the client's configuration, since
  what it reached was a working tree with no permission check in front of it.

  Two API changes if you built your own host on `createValTools`:

  - `ValToolContext.auth` no longer has a `{ type: "pat", pat }` variant.
    `{ type: "verified-profile", profileId, scopes }` is the only credential the
    registry accepts, and `null` still means local filesystem mode.
  - `createValOps` no longer takes an `auth` argument. `ValOpsHttp` still accepts
    a personal access token directly — that is how `val debug` uses the token from
    `val login` — but no server request builds one.

  Proxy mode also stops keeping one data layer per credential. Each personal
  access token needed its own `ValOpsHttp` to hold it, each of those cached the
  project's evaluated modules, and the bounded cache that kept the memory in
  check turned an eviction into a re-evaluation of every module on the next call.
  Verified callers all share one instance, because they all reach the backend
  under the app's own API key.

### Patch Changes

- [#618](https://github.com/valbuild/val/pull/618) [`da6794f`](https://github.com/valbuild/val/commit/da6794f3dbd77d49ccfe780b359bab1689ee1b11) Thanks [@freekh](https://github.com/freekh)! - Remove the unused `GET /api/val/session` endpoint.

  Nothing called it. The Studio reads the profile id from `/stat`, and in proxy
  mode the route proxied to `${VAL_BUILD_URL}/api/val/${project}/auth/session`,
  an upstream route that no longer exists — so calling it by hand returned a 500
  rather than a session. It is gone from both the route declarations in
  `@valbuild/shared` and the implementation in `@valbuild/server`.

  Session cookie handling itself is unchanged: `/authorize`, `/callback` and
  `/logout` still set and clear `val_session` as before.

- Updated dependencies [[`be32261`](https://github.com/valbuild/val/commit/be32261af19db8018bc37b180d903416018c0b79), [`da6794f`](https://github.com/valbuild/val/commit/da6794f3dbd77d49ccfe780b359bab1689ee1b11), [`1c8b7fd`](https://github.com/valbuild/val/commit/1c8b7fda1e84cd8bd32a03a85d2789598b98c3fb)]:
  - @valbuild/shared@0.122.0
  - @valbuild/ui@0.122.0

## 0.121.0

### Minor Changes

- [#464](https://github.com/valbuild/val/pull/464) [`2bcc6fd`](https://github.com/valbuild/val/commit/2bcc6fdff8d668123e07e3c5e81ac6fa1436e47b) Thanks [@freekh](https://github.com/freekh)! - Add staging and unstaging of pending changes, so one person can publish a small fix without shipping somebody else's unfinished work.

  A **patch group** is the set of patches one user has chosen to publish. It is not a patch _set_: a patch set is computed from the schema and says which patches must move together, while a patch group is curated and says which ones you want live.

  A group holds its owner's own work plus whatever the closure entangled with it — not everything pending. **So Publish changes meaning on a shared branch: it ships your changes and what they depend on, instead of everything anybody has pending.** That is the feature. Unstaging goes further: hold one of your own changes back and it leaves both your preview and your publish, while still existing for everyone else.

  The rule relating the two is that for every group and every patch set, the group's members within that patch set must form a prefix in patch-chain order. Staging a change therefore pulls in whatever preceded it in the same patch set; unstaging drops whatever was built on top of it. The compare view names what a toggle moves, and whose it is, rather than quietly enlarging or shrinking a publish.

  Editing inside a region you are holding back is allowed, and the patches you were holding are loaded back in rather than the edit being refused. An earlier design made such a region read-only until it was staged again, because an author picks an array index while looking at their own view — so re-staging patches afterwards can shift the content under the path they just chose, and their edit lands on the wrong element cleanly, with every invariant intact and only the content wrong. That guard is not what ships. It is a rare shape in practice, since two people's edits mostly land in different routes, and refusing an edit for a reason the author cannot see is a worse everyday experience than the case it prevents. Instead the real result is shown immediately: the widened set is what the editor renders and what the compare view lists.

  Also fixes a pre-existing bug in patch set grouping: patch set paths were compared with a raw string prefix test, and nothing terminates a path segment, so `?foobar/title` matched `?foo`. Deleting record key `foo` and retitling record key `foobar` were treated as one inseparable change. Previously that over-grouped two unrelated edits in the review screen; with staging it would have meant publishing a deletion nobody asked for.

  The `/patches` routes gain optional patch group fields and `/patch-groups/~/patches` is new. This needs a content API that has patch groups. Filesystem mode keeps the group in the client, since it has a single author and already sends an explicit patch id list when publishing.

  When a save pulls other people's changes in, you are told: a toast names how many and whose. There is no undo, because your edit was written against the view those changes produce and now depends on them — the compare view shows the widened set.

  Two other things keep a session honest about a shared branch. `/stat` now says which pending changes have already been published, so another author's publish stops looking pending in your Studio the moment it lands rather than when the site redeploys. And Publish refuses, without writing anything, if somebody published while you were reviewing — the review screen you acted on described a branch that has since moved.

  Two things this does **not** do yet, both of which need the group annotation to refresh on its own rather than only inside a fetch for missing patch ids:

  - a stage or unstage in one tab does not reach another tab;
  - if persisting a stage fails, the local view keeps it until the page is reloaded.

  `docs/independent-publish/DESIGN.md` describes the model and lists what is still a judgement call.

- [#605](https://github.com/valbuild/val/pull/605) [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79) Thanks [@freekh](https://github.com/freekh)! - `s.settings()`: the project's settings, as content.

  A settings module is one per project, at the root of the content tree:

  ```typescript
  // settings.val.ts
  export default c.define("/settings.val.ts", s.settings(), {});
  ```

  Register it in `val.modules.ts` like any other module, and it shows up in the
  Studio under the cog at the foot of the left rail. Everything in it is content:
  it is edited as a draft, it appears in the publish diff, and it is the same for
  everyone working on the project.

  Every key is optional, at every level, so `{}` is a complete settings module —
  and stays one as sections are added. What it holds today is the assistant:

  ```typescript
  export default c.define("/settings.val.ts", s.settings(), {
    assistant: {
      enabled: true,
      context: "A CMS for developers, run by a team of four in Oslo.",
      tone: "Plain and direct. British English, sentence case in headings.",
    },
  });
  ```

  `context` is background the assistant would otherwise guess at; `tone` is how it
  should write when it writes content. Both are sent with every message it makes.

  `enabled` decides whether editors have an assistant, and it has **three** states
  rather than two:

  - `true` — they do.
  - `false` — they do not, and every trace of it goes: no button in the top bar,
    no row in the quick actions, no panel, nothing sent.
  - unset — nobody has decided. The assistant is still **shown**, and asks to be
    turned on before it is used. Hiding an assistant nobody has decided about
    means nobody discovers it; quietly enabling one means a project starts sending
    its content to a model because it did not know to say no.

  A project with no settings module at all has an assistant, as before: there is
  nowhere to record a decision, and nowhere for the prompt to write the answer.

  **Breaking: `ai.chat` is gone from `val.config.ts`.** Whether the assistant is
  available is a decision about the project's content, made by the people who edit
  it, so it moved to settings — turning the chat on used to take a developer, a
  deploy and a code review of a boolean. Remove the whole block:

  ```diff
   const { s, c, val, config } = initVal({
  -  ai: {
  -    chat: {
  -      experimental: { enable: true },
  -      suggestions: ["Summarize", "Fix typos at this page"],
  -      title: "Ask me anything",
  -      description: "Val can answer questions about the content.",
  -    },
  -  },
   });
  ```

  `experimental.enable` becomes `assistant.enabled` in the settings module.
  `suggestions`, `title` and `description` are removed with nothing replacing
  them: the assistant now opens with its own copy. A project that had the chat
  enabled and wants it to stay on for everyone should write
  `assistant: { enabled: true }` — otherwise editors are offered it and asked.

  `ai.commitMessages` stays in `val.config.ts`, and is unaffected.

  Two settings modules, or one in a subdirectory, is a module error: the dev
  server refuses to serve sources, `npx val validate` reports it against the file,
  and the Studio says so rather than picking one.

### Patch Changes

- Updated dependencies [[`105479b`](https://github.com/valbuild/val/commit/105479b84a08846f1fe5971916f6a54275198d12), [`55ec736`](https://github.com/valbuild/val/commit/55ec73651394908b6f440e360d181b95a91c0a93), [`2bcc6fd`](https://github.com/valbuild/val/commit/2bcc6fdff8d668123e07e3c5e81ac6fa1436e47b), [`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2), [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79), [`2db27d5`](https://github.com/valbuild/val/commit/2db27d555441bee2dd31817acc8c92b7b718ee55)]:
  - @valbuild/ui@0.121.0
  - @valbuild/shared@0.121.0
  - @valbuild/core@0.121.0

## 0.120.4

### Patch Changes

- Updated dependencies [[`6df3cae`](https://github.com/valbuild/val/commit/6df3caec1cc043a07b532d3174583b8218d4871d)]:
  - @valbuild/ui@0.120.4

## 0.120.3

### Patch Changes

- Updated dependencies [[`9b96184`](https://github.com/valbuild/val/commit/9b96184cf6ad6d52a714867fb1527eeec6c776f4), [`1a2484a`](https://github.com/valbuild/val/commit/1a2484a309679bd5e963d626466c2828f74d49f8), [`71becc7`](https://github.com/valbuild/val/commit/71becc7e543432e4a57e36d54aaf803e9a447ffd)]:
  - @valbuild/ui@0.120.3

## 0.120.1

### Patch Changes

- [#590](https://github.com/valbuild/val/pull/590) [`6f318d4`](https://github.com/valbuild/val/commit/6f318d406295b772e721bf463283f47e2822e996) Thanks [@freekh](https://github.com/freekh)! - MCP: survive a signing-key rotation, and say what a refused local token means.

  `@valbuild/next` caches the authorization server's JWKS for five minutes. Until
  now a token signed with a key that arrived inside that window was refused
  outright, so every warm instance rejected valid tokens until the cache expired —
  a rotation on the issuer's side showed up as an outage on yours.

  A token naming a key the cache does not hold now provokes one refetch of the key
  set, at most once per issuer every 30 seconds. The rate limit matters because the
  key id comes from the token: without it, unknown key ids would be a way to make
  your app call its issuer once per request. It limits how often a fetch is
  _started_, so requests that arrive while one is already running join it — which
  is the normal shape of a rotation, where many requests meet the new key at once.

  Separately, an MCP call that presents an access token to a project running in
  local filesystem mode is still refused — there is nothing to authenticate against
  — but the message now names the cause, which is that the project has an `oauth`
  issuer configured (often `VAL_OAUTH_ISSUER` in a local `.env`) and should not
  have one for local development.

## 0.120.0

### Patch Changes

- Updated dependencies [[`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a)]:
  - @valbuild/core@0.120.0
  - @valbuild/shared@0.120.0
  - @valbuild/ui@0.120.0

## 0.119.0

### Patch Changes

- Updated dependencies [[`84165f7`](https://github.com/valbuild/val/commit/84165f743eb5802da1e8079bbe98eafcb2cdcec8)]:
  - @valbuild/ui@0.119.0

## 0.118.0

### Minor Changes

- [#574](https://github.com/valbuild/val/pull/574) [`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95) Thanks [@freekh](https://github.com/freekh)! - The assistant lets you pick which model answers, from the models your key can
  actually reach.

  The content server now asks each provider what a key may use and reports the
  answer; the Studio offers exactly that, beside the composer. Which model to use
  is a per-message decision — something cheap for a typo, something strong for a
  hard question — so the control sits where the message is written rather than in
  a settings panel.

  The choice is remembered per browser and re-checked against what is on offer
  each time the assistant starts, so a model an account has lost access to is
  quietly replaced instead of being sent and refused.

  A content server that does not report models, or could not reach a provider,
  leaves the built-in catalog as the fallback, filtered to reachable providers.

### Patch Changes

- Updated dependencies [[`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95), [`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95), [`fe6a398`](https://github.com/valbuild/val/commit/fe6a3981691394e6f34d4d80ec17febd356a98cc)]:
  - @valbuild/ui@0.118.0
  - @valbuild/shared@0.118.0

## 0.117.1

### Patch Changes

- Updated dependencies [[`0ae7bac`](https://github.com/valbuild/val/commit/0ae7bac8a186460bc2b31f2ded89b00027bafb55)]:
  - @valbuild/ui@0.117.1

## 0.117.0

### Minor Changes

- [#582](https://github.com/valbuild/val/pull/582) [`fca3efa`](https://github.com/valbuild/val/commit/fca3efa389e2817401f55ea3dd184af7c611b807) Thanks [@freekh](https://github.com/freekh)! - Accept OAuth access tokens on the MCP endpoint, so editors can authorize as themselves

  `initValMcp` takes an optional `oauth` config. Give it the authorization server's
  URL and this endpoint's own URL, and every MCP call must then present an access
  token that Val's authorization server issued:

  ```ts
  const { valMcpAuthorize, valMcpTools, valMcpMetadata } = initValMcp(
    valModules,
    config,
    {
      oauth: {
        issuer: "https://admin.val.build",
        resource: "https://your-app.com/api/mcp",
      },
    },
  );
  ```

  The token is verified in your app — signature against the issuer's published
  keys, plus issuer, audience and expiry — so the caller's identity is checked
  rather than claimed. **Patches created over MCP now carry that profile as their
  author**, which is what makes an edit made from a phone show up in the review
  screen as somebody's rather than nobody's. Scopes are enforced too: a token
  without `val:write` cannot reach a tool that writes.

  Mount the discovery document so clients can find where to authorize:

  ```ts
  // app/.well-known/oauth-protected-resource/route.ts
  import { valMcpMetadata } from "../../../val/mcp";
  export const { GET, OPTIONS } = valMcpMetadata!;
  ```

  `valMcpMetadata` is `null` when no `oauth` config is given.

  **Nothing changes if you leave `oauth` out.** Local development still works with
  no authorization server, and an app already using a personal access token keeps
  working as before.

  One breaking change if you built your own host on `createValTools`:
  `ValToolContext.auth` is now a tagged union, so `{ pat }` becomes
  `{ type: "pat", pat }`. The new variant is
  `{ type: "verified-profile", profileId, scopes }`, for a host that verified a
  token itself.

### Patch Changes

- [#579](https://github.com/valbuild/val/pull/579) [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d) Thanks [@freekh](https://github.com/freekh)! - Every release now ships a changelog. Each package's `CHANGELOG.md` records what
  changed under the version that shipped it — with a link to the pull request, the
  commit and the author — and the same entry becomes the body of the GitHub
  Release for the tag. The file is included in the npm tarball, so it is also
  readable from an installed copy.

  Up to now those changelogs were generated empty, and the GitHub Releases with
  them, so there was no record of what any given version contained. Releases from
  this one on have one; earlier versions stay blank.

- Updated dependencies [[`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f), [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d)]:
  - @valbuild/core@0.117.0
  - @valbuild/shared@0.117.0
  - @valbuild/ui@0.117.0
