# @valbuild/tanstack-build

## 0.148.5

### Patch Changes

- [#899](https://github.com/valbuild/val/pull/899) [`acc5fee`](https://github.com/valbuild/val/commit/acc5feef498edbb9a7d3e8715bfb516d26079669) Thanks [@freekh](https://github.com/freekh)! - A project's dependency layer no longer builds Val's server entry points for the browser. `@valbuild/tanstack/server` and `@valbuild/tanstack/demo` go in the worker half only, so the browser half stops carrying code nothing in the browser imports. `@valbuild/tanstack/demo` is about 15 MB: on the Val demo the browser half went from 20.2 to 4.8 million characters, and the whole layer from 40.8 to 25.4. Importing either from client code is still reported by name, as for any server-only dependency.

## 0.148.3

### Patch Changes

- [#887](https://github.com/valbuild/val/pull/887) [`eaa77e0`](https://github.com/valbuild/val/commit/eaa77e0e5028b113037e76722e25e342a8301032) Thanks [@freekh](https://github.com/freekh)! - Content analytics records the content version each page was rendered from. `<ValProvider analytics>` takes a `ValAnalytics` -- `{ enabled, contentVersion? }` -- and the `val.server.ts` Val's hosting writes returns one from `fetchValAnalytics()`, with the id of the content version the platform is serving. Every beacon carries it as `cv`, so counts can be compared across a publish. The site layout passes `fetchValAnalytics()` to the provider exactly as before.

- [#878](https://github.com/valbuild/val/pull/878) [`4d862ce`](https://github.com/valbuild/val/commit/4d862cec40288ecbc415c3c3b8d792ddd6bc1ca3) Thanks [@freekh](https://github.com/freekh)! - TanStack Start: a new analytics mode, the first step towards content analytics. It is off by default. With `<ValProvider analytics>`, content read with the hooks (`useVal`, `useValRoute`, `useValKey`) is tagged for every visitor, not only in draft mode, so each element showing content carries a `data-val-path`. The tags are added in the browser after hydration, so the HTML the server sends is unchanged and a crawler that does not run the page never sees them.

  On a site hosted by Val, analytics is a project setting: the owner turns it on in the project's settings, and the `val.server.ts` the platform writes now exports `fetchValAnalytics()` to read it. Pass it to the provider from the site layout's loader, beside `fetchValDraft()`; see the README.

## 0.148.0

### Patch Changes

- [#886](https://github.com/valbuild/val/pull/886) [`4176757`](https://github.com/valbuild/val/commit/41767579b01849473a94779122fd39c07dd99234) Thanks [@freekh](https://github.com/freekh)! - Building a project's dependency layer takes one build per target again, instead
  of falling back to building every dependency on its own. A dependency that
  reaches a Node builtin from the browser side (`@valbuild/tanstack/server`,
  `@valbuild/mcp`, `sharp`) or loads a native binary (`@tailwindcss/vite`) used
  to fail the first build, and finding out which one did took two builds per
  dependency. Now the first build finds them, and the layer is the same as
  before.

  The import check after each build also reads only a chunk's import
  statements, found with `es-module-lexer`, instead of parsing the whole chunk:
  Val's server chunk is 20 MB.

  On the `template-tanstack` projects the two together took a layer build from
  about 45 s and 2.8 GB to 8–12 s and 1.1–1.25 GB. Each server-only or skipped dependency is
  now reported with the builtin or binary it reached and the module that asked
  for it.

## 0.146.0

### Minor Changes

- [#861](https://github.com/valbuild/val/pull/861) [`89b0fa8`](https://github.com/valbuild/val/commit/89b0fa82a3ae0d8ccd5d0282c1034f1f40cc4e26) Thanks [@freekh](https://github.com/freekh)! - Proposals can be brought up to date with the site, like a pull request.

  - **Update from the site** merges what was published on the site since a proposal started into the proposal, field by field. Where the site and the proposal changed the same field, the Publish dialog shows both and asks which to keep.
  - **With code:** a proposal that changes code, or a site whose code changed since the proposal started, is updated too. The Studio runs each version's schemas in the tab, and the merged code is built before it can be published.
  - Publish offers **Update from the site** whenever the site has moved under the proposal.

## 0.145.1

### Patch Changes

- [#860](https://github.com/valbuild/val/pull/860) [`a45f595`](https://github.com/valbuild/val/commit/a45f595a5e20b009d4110bbef8ebdc08b2d731d7) Thanks [@freekh](https://github.com/freekh)! - `val publish` now refuses to build a site whose installed TanStack disagrees with the platform's. A project's CI builds its dependency layer from its own `node_modules`, and a lockfile two patches away from the platform's `@tanstack/*` used to publish fine and then fail on the first request that reached the mismatched code — typically signing in — with "does not provide an export named …". The build now stops with a message naming the package, the version the project resolved and the version the platform carries, and the fix is to pin the package to that version (with `pnpm.overrides` for a transitive one) and reinstall.

  The same build also checks every import a dependency takes from the platform's React and TanStack against what the platform says those modules export, which until now ran only in the platform's own checkout.

  Both checks use what the platform reports about itself, so they run once the platform does; until then `val publish` builds as before and says in its output that the check was skipped. They run in the `@valbuild/tanstack-build` the project has installed, so upgrade it alongside `@valbuild/cli`.

- [#860](https://github.com/valbuild/val/pull/860) [`a45f595`](https://github.com/valbuild/val/commit/a45f595a5e20b009d4110bbef8ebdc08b2d731d7) Thanks [@freekh](https://github.com/freekh)! - A server function's validator no longer ships to the browser. TanStack Start removes `createServerFn().validator(...)` and `.inputValidator(...)` from client code, because a validator only ever runs on the server; the Val build replaced the handler but left the validator in, so its code — and anything it imported — reached every visitor's bundle. Both spellings are handled: TanStack Start 1.169 removed `.inputValidator()`, and 1.168 has both.

## 0.144.4

### Patch Changes

- [#835](https://github.com/valbuild/val/pull/835) [`e70a261`](https://github.com/valbuild/val/commit/e70a261ed8c0938b635214721fc4e445704b1f1f) Thanks [@freekh](https://github.com/freekh)! - A build is now named by what it was built from rather than by what it produced, so publishing the same project files again reuses the build the site already has. When that build is still held, the Studio skips building and uploading it.

## 0.144.2

### Patch Changes

- [#832](https://github.com/valbuild/val/pull/832) [`ab0ea20`](https://github.com/valbuild/val/commit/ab0ea2046e3872c4955f34b363881f76d48d1b1e) Thanks [@freekh](https://github.com/freekh)! - A site served by Val's platform can now be given its content separately from its build. When the platform hands a TanStack app a content version (`VAL_CONTENT`) that differs from what the build bundles, Val renders that content, in the Studio and in draft mode too. It reads it the way it already reads a proposal's saved content.

  Nothing changes for an app that is not given one, and nothing hands one over yet. This is the reading side of publishing content without rebuilding the site.

  A version too large for one environment variable can name others under `refs` (`"env://VAL_CONTENT_1"`), each holding one module's Source or one file's text. Only `refs` is resolved, never a string inside your content, and only variables named `VAL_CONTENT_<n>` are read.

  At a proposal's address, a proposal's saved content is shown over the content version the site serves, so modules the proposal did not change show what the site shows rather than what the build bundles.

  When Val's platform puts a publish live without building the site, because it changed only content, the Studio shows it being checked and going live instead of "Building".

## 0.144.0

### Patch Changes

- [#827](https://github.com/valbuild/val/pull/827) [`1272b14`](https://github.com/valbuild/val/commit/1272b1408cf55fefccdce442352c208a7f69f44b) Thanks [@freekh](https://github.com/freekh)! - Publishing to Val's platform, through `val publish` or the Studio, now handles a stylesheet that imports other stylesheets, and fonts installed as packages:

  ```css
  /* src/styles.css */
  @import "tailwindcss";
  @import "./theme/theme.css";

  /* src/theme/theme.css */
  @import "@fontsource-variable/inter";
  ```

  Before this, the platform's build passed `@import "./theme/theme.css"` on to Tailwind without resolving it, and publishing stopped with `Tailwind asked for './theme/theme.css', which this build does not carry`. A font package such as `@fontsource-variable/inter` was built as code, failed, and was skipped.

  - A stylesheet's own `@import`s are inlined where they were written, the same way `vite build` handles them. That covers relative files and stylesheets that dependencies ship. `layer()`, `supports()` and media conditions are kept, and a stylesheet imported twice is only included once.
  - The files a dependency's stylesheet points at with `url(...)`, such as a font package's `.woff2` files, are published with the site and served from it.

## 0.142.0

### Patch Changes

- [#805](https://github.com/valbuild/val/pull/805) [`fa03698`](https://github.com/valbuild/val/commit/fa03698ef0f2c7a6df334b4ba0e41843bde60029) Thanks [@freekh](https://github.com/freekh)! - Groundwork for proposals on the Val platform: a server can be told it is running at a proposal's address (`proposal` in the http options, `proposalFromEnv` to read it from the platform). There, the content the proposal has saved replaces the bundled content for those modules on every read, edits go to the proposal's branch, and Save commits to the proposal instead of the site. Nothing changes for a site that is not given a proposal.

## 0.140.1

### Patch Changes

- [#795](https://github.com/valbuild/val/pull/795) [`bbc2f0c`](https://github.com/valbuild/val/commit/bbc2f0cba5778b2095695cc0f6e23c66ce326a89) Thanks [@freekh](https://github.com/freekh)! - A project made from the TanStack starter builds on Val Build again. Since the starter started reading the page's draft (`fetchValDraft`, so a draft page is rendered as the draft from the first paint), its `src/val/val.server.ts` exports one more reader, and the `val.server.ts` that Val Build writes in its place did not, so the build failed with `"fetchValDraft" is not exported by "src/val/val.server.ts"`. The written file now exports it. With an `@valbuild/tanstack` older than 0.140.0 it returns no draft, which is how those versions render anyway.

## 0.139.0

### Patch Changes

- [#782](https://github.com/valbuild/val/pull/782) [`ab97279`](https://github.com/valbuild/val/commit/ab9727935223bd8356976a15d09cb69a523e1140) Thanks [@freekh](https://github.com/freekh)! - The `src/val/project-source.d.ts` that wiring a project up to the platform writes now actually declares `platform:project-source`. It was a module (it ended in `export {}`), which made its `declare module` an augmentation of a module that does not exist, so `import { FILES } from "platform:project-source"` in the generated `val.server.ts` failed to resolve in an editor and in `tsc`. Re-wiring a project rewrites the file.

## 0.138.6

### Patch Changes

- [#774](https://github.com/valbuild/val/pull/774) [`9d28775`](https://github.com/valbuild/val/commit/9d287750631b239b70bc7545e3b9fa9011e81db7) Thanks [@freekh](https://github.com/freekh)! - Edits no longer disappear from a site on Val Build for up to a minute after its first publish.

  For a short while after a publish, the site can still serve the previous build. If that build was the project's starting template, it was treated as though it already had the new changes, so they vanished from the page until the new build reached you. Each build now tells Val's content service which build it is, and gets exactly the changes it is missing.

## 0.138.4

### Patch Changes

- [#771](https://github.com/valbuild/val/pull/771) [`63bff05`](https://github.com/valbuild/val/commit/63bff0589b6df42efaa63ec606688d20a9670439) Thanks [@freekh](https://github.com/freekh)! - Changes that are already published no longer briefly vanish from the Studio, or show up twice, right after a publish in app mode.

  A build the Studio makes in the browser now records which publish it was made for, so Val knows exactly which changes the running site already has. Before this, Val worked that out from whichever build was live, and was wrong for a moment while a publish was going live. A reload in that moment could hide changes that were not on the site yet, or apply ones that were a second time. Projects set up before this release need no changes.

## 0.136.10

### Patch Changes

- [#741](https://github.com/valbuild/val/pull/741) [`4d3e7dc`](https://github.com/valbuild/val/commit/4d3e7dce6b07390f6c47089b5a949dc5fd8409fd) Thanks [@freekh](https://github.com/freekh)! - Sites published in app mode are now built the way `vite build` builds them:

  - **TanStack Devtools are removed.** `@tanstack/react-devtools` has no production switch; `vite build` drops it only because the `devtools()` plugin in `vite.config.ts` strips it from your source, and app mode does not run Vite plugins. So a project that renders `<TanStackDevtools>` unconditionally, as the starter template does, showed the devtools panel on its published site. The builder now does the same stripping itself.
  - **`import.meta.env.DEV`, `PROD`, `MODE`, `SSR` and `BASE_URL` are defined**, and `process.env.NODE_ENV` is `"production"` in your own code. Before, `import.meta.env.PROD` read `undefined` and `process.env.NODE_ENV` read `"development"`.

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
