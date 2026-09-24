# @valbuild/tanstack-build

## 0.136.3

### Patch Changes

- [#726](https://github.com/valbuild/val/pull/726) [`3b19534`](https://github.com/valbuild/val/commit/3b19534bb7aa16452a104906d9594083c3bc3e89) Thanks [@freekh](https://github.com/freekh)! - A Studio publish of a project with no repository now ships every edit that was saved, and keeps the site styled.

  - A host that embeds the project's source can hand it to Val as `projectSource` (`initValServer(..., { http: { projectSource } })`). A publish then patches that text, not text fetched from the content service at a commit, which a project with no repository does not have. The build platform's wiring passes the build's own source, so `.val.ts` can be rendered for a project made on `/new`. Before, its first save produced no files, and the build that followed carried none of the save's edits.
  - New route `GET /api/val/built-source`: the `.val.ts` text of every module changed since the running build, with every commit since it applied. The Studio builds from it, so an edit whose own publish failed, and a Finish publishing, are no longer left out of the next build.
  - A Studio build that compiles no stylesheet (a browser cannot run Tailwind `@plugin`s) keeps the live site's. A Studio save never changes a stylesheet or a component, so the live CSS is still the right one.

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

## 0.135.0

### Minor Changes

- [#712](https://github.com/valbuild/val/pull/712) [`8181db8`](https://github.com/valbuild/val/commit/8181db81050d94fe9080a7bc50c051e570165213) Thanks [@freekh](https://github.com/freekh)! - New package: `@valbuild/tanstack-build` builds a TanStack Start app from a Val
  project's files — in the browser, and in Node.

  It carries three things that were previously in the platform repository:

  - **the build** — `buildUserApp(input)` produces the server, client and RSC
    bundles, the CSS, the assets and the chunk map, on `@rolldown/browser`, so it
    runs in a tab;
  - **the wiring** — `wireUp(files, options)` writes a project's
    `src/val/val.server.ts` against `@valbuild/tanstack/server`;
  - **the contract** — `BuildTarget`, `UserApp`, `PublishManifest` and the rest of
    the types a host and a build have to agree on.

  The wiring is the reason for the move rather than a passenger of it. It writes
  code against `initValServer`'s signature, and it used to do that from another
  repository on another release train — so a change to that signature could not
  break it until somebody published, which is to say a user found it. It is now
  beside the function it calls.

  Everything that needs Node is behind the `@valbuild/tanstack-build/node`
  subpath: the project dependency layer, the route tree, Tailwind's `@plugin` and
  `autoCodeSplitting`. The root entrypoint reaches none of it, and a test walks
  the import graph to keep that true — a browser bundle that pulled in `rolldown`
  or a `node:` builtin would fail in the consuming app's build rather than here.
  `rolldown`, `@tanstack/router-generator` and `@tanstack/router-plugin` are
  optional peer dependencies for the same reason: they are things a project asks
  for.

  Type-checking this code for the first time, and reviewing it once it was here,
  found several things that had been invisible where it lived — that build strips
  types rather than checking them, and its one check of the generated server file
  runs `tsc --noResolve`, so it cannot see across an import at all.

  The one that mattered most is about a rename that has gone both ways.
  `ValHttpMode` took `gitCommit`/`gitBranch` up to 0.132, a nested `git` from
  0.133.0, and is flat again here — and the generated `val.server.ts` is compiled
  and run against whatever `@valbuild/tanstack` the PROJECT installed, which the
  platform writing the file has no say in. Sending only the name this release
  knows drops the commit for every app still on 0.133.x, silently: the publish
  then produces no mirrored `.val.ts`, so a save commits and hands over nothing,
  and the site keeps serving its old content with the patches already consumed.
  The template now sends all three keys, and each version reads its own and
  ignores the rest.

  There is also a test that compiles the generated file against the real package,
  with resolution — the platform's own check runs `tsc --noResolve`, so it cannot
  see across an import at all. It is the right tool for a name that no longer
  exists and the wrong one for this, and it says so: the compiler in this
  repository is looking at a different version of `@valbuild/tanstack` than the
  app is.

  Two more, both of which changed behaviour:

  - A split route's deferred half skipped every source transform, so
    `<ClientOnly>` and `createIsomorphicFn()` in a route component were rewritten
    when no splitter was supplied and left alone when one was. Splitting is
    allowed to cost bytes and not to change behaviour.
  - The project dependency-layer build re-audited chunks it had just dropped,
    because its fast path and its retry shared an output directory that nothing
    cleared — so the recovery failed for exactly the case it exists for.

  And the four the compiler found on its own:

  - Tailwind's `loadModule` contract was restated by hand and restated wrongly —
    Tailwind also wants a `path`, and the CLI's loader had never sent one. The
    type is now derived from Tailwind's own option, so an upgrade that changes the
    shape is a compile error rather than an `undefined` handed to someone else's
    code.
  - The rolldown output filter was `(chunk: any) => chunk.type === 'chunk'`, which
    does not narrow, so every `.code` read after it was unchecked.
  - The route generator was handed `verboseFileRoutes: true`, a key that is not in
    its config, its types, or anywhere in its dist — inert, behind an `as any`.
  - The same cast was hiding a key the generator does require. Both are gone, and
    so is the cast.
