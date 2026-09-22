# @valbuild/cli

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

- Updated dependencies [[`c9affec`](https://github.com/valbuild/val/commit/c9affece6ae6ba62bd6c1113ed1fdab6317fa112), [`72a7ca7`](https://github.com/valbuild/val/commit/72a7ca78354fff00e37a51359b17fba9334dc5e6)]:
  - @valbuild/server@0.135.0
  - @valbuild/language-server@0.135.0

## 0.134.1

### Patch Changes

- Updated dependencies [[`821e789`](https://github.com/valbuild/val/commit/821e789c1af47510af5d23eb96384ff78ddd7646)]:
  - @valbuild/shared@0.134.1
  - @valbuild/language-server@0.134.1
  - @valbuild/server@0.134.1

## 0.134.0

### Minor Changes

- [#698](https://github.com/valbuild/val/pull/698) [`15c5367`](https://github.com/valbuild/val/commit/15c536746c0f813a51a2dce8a2cb1e617174c238) Thanks [@freekh](https://github.com/freekh)! - Add `val publish`, which publishes a project's build through content.val.build.

  ```sh
  npx val publish                          # publish the artifacts in .val/publish
  npx val publish --artifacts build/out    # publish a directory by name
  npx val publish --dry-run                # verify, and stop before the site changes
  ```

  It declares what the build is made of — every artifact by key, sha256 and size
  — uploads only the ones content does not already hold, straight to object
  storage, and then has content build and render the build as a canary before
  anything goes live. A build content already holds uploads nothing. A canary
  that does not render is never promoted, and the command exits non-zero with
  content's own problem codes, hints included, so CI gates on it. Declaring the
  same build twice resumes that publish rather than starting a second one, so a
  re-run of a CI job picks up where it left off.

  The artifacts are read from a directory whose layout is the key namespace:
  the path of each file under it is its artifact key — `server`, `client`,
  `css`, `rsc`, `layer`, or a path under `chunk/server`, `chunk/client`,
  `chunk/rsc`, `asset`, `public`. Nothing is renamed on the way, since an asset
  is addressed by the path the built code imports it at.

  Authenticates with `VAL_PROJECT_TOKEN` — the single secret a repository needs,
  since the token names its project — or with the `val login` token in
  `.val/pat.json`, which is exchanged for a ten minute publish token and needs
  the project (`"<org>/<project>"`) in `val.config` or `VAL_PROJECT`. Never a
  command line flag: an argument is visible to anyone who can list processes,
  and it is kept in shell history and in the log of every CI job that echoes its
  command line.

  The commit and branch the build is of are taken from `--commit` / `--branch`,
  then `VAL_GIT_COMMIT` / `VAL_GIT_BRANCH`, then `GITHUB_SHA` / `GITHUB_REF_NAME`,
  then git. The commit is baked into the published site and decides which version
  of its own content it reads, so the command refuses rather than guessing when
  it cannot tell.

### Patch Changes

- Updated dependencies [[`be78a9b`](https://github.com/valbuild/val/commit/be78a9b51678439f7ecb1c7f3887f9e8e1261a13), [`16c49ea`](https://github.com/valbuild/val/commit/16c49ea6dd97c7a96bbfdf211af9bab5884579e2), [`eaa265e`](https://github.com/valbuild/val/commit/eaa265e78d9f6d2a1b685c38901612b8a3704eed)]:
  - @valbuild/server@0.134.0
  - @valbuild/core@0.134.0
  - @valbuild/shared@0.134.0
  - @valbuild/language-server@0.134.0

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

- Updated dependencies [[`802412b`](https://github.com/valbuild/val/commit/802412b92c06bc1abbca78c86885e39c8710dd83)]:
  - @valbuild/server@0.133.0
  - @valbuild/shared@0.133.0
  - @valbuild/language-server@0.133.0

## 0.132.1

### Patch Changes

- Updated dependencies [[`c07b1ab`](https://github.com/valbuild/val/commit/c07b1abe30e226c80ef7ec4b4f0f5ccdae061c11), [`cbfa2b8`](https://github.com/valbuild/val/commit/cbfa2b884898f1603bde8e5aa5cd9da78778101f), [`f2ac188`](https://github.com/valbuild/val/commit/f2ac1887c11397b597081eef7206063b52b21c5b)]:
  - @valbuild/server@0.132.1
  - @valbuild/language-server@0.132.1

## 0.132.0

### Patch Changes

- Updated dependencies [[`72cc676`](https://github.com/valbuild/val/commit/72cc6765e92a6e72b5c09ddd9eed8efa7ce899f2)]:
  - @valbuild/server@0.132.0
  - @valbuild/language-server@0.132.0

## 0.131.0

### Patch Changes

- Updated dependencies [[`0d5857b`](https://github.com/valbuild/val/commit/0d5857b731e11f7e6a011f79297df6485908c31f)]:
  - @valbuild/server@0.131.0
  - @valbuild/language-server@0.131.0

## 0.130.0

### Patch Changes

- Updated dependencies [[`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`8425378`](https://github.com/valbuild/val/commit/8425378c315ea46b5d822f1130b633e0449ff1b0), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`473a185`](https://github.com/valbuild/val/commit/473a185f70351b44388f3bc1852649e2c1dbe001), [`64f0de3`](https://github.com/valbuild/val/commit/64f0de339b8621cb5a6c422dfe55cae5b2bbe2a0), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75)]:
  - @valbuild/server@0.130.0
  - @valbuild/core@0.130.0
  - @valbuild/language-server@0.130.0
  - @valbuild/shared@0.130.0

## 0.129.0

### Patch Changes

- Updated dependencies [[`7d34ecc`](https://github.com/valbuild/val/commit/7d34ecce787a0709025ae7b4764cb6c3ad1f766b), [`0c351c4`](https://github.com/valbuild/val/commit/0c351c4f97ae7f09772eab0e856ae69821b803b7)]:
  - @valbuild/core@0.129.0
  - @valbuild/shared@0.129.0
  - @valbuild/server@0.129.0
  - @valbuild/language-server@0.129.0

## 0.128.0

### Patch Changes

- Updated dependencies [[`8b52b33`](https://github.com/valbuild/val/commit/8b52b33e1f629f14f66cc71dcc7cf415d210c7d4), [`362fb49`](https://github.com/valbuild/val/commit/362fb49f30d2b04c4ff78d54dca2bf5ad978a05c), [`c595799`](https://github.com/valbuild/val/commit/c59579977a436ec530c6c69f2b340ab9829d97ab)]:
  - @valbuild/core@0.128.0
  - @valbuild/language-server@0.128.0
  - @valbuild/server@0.128.0
  - @valbuild/shared@0.128.0

## 0.127.0

### Patch Changes

- Updated dependencies [[`7fa8699`](https://github.com/valbuild/val/commit/7fa869974bc895af992a7d5c18b76253636d7d65), [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63), [`88262ac`](https://github.com/valbuild/val/commit/88262ac8db068650a664981ef73556457d87741a), [`7072e07`](https://github.com/valbuild/val/commit/7072e07623c953a09ac14388ae22dada0b431ce3), [`29811c3`](https://github.com/valbuild/val/commit/29811c3f8c7e001a950e6f4833af6888e6a4efea)]:
  - @valbuild/core@0.127.0
  - @valbuild/shared@0.127.0
  - @valbuild/server@0.127.0
  - @valbuild/language-server@0.127.0

## 0.126.0

### Patch Changes

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

- Updated dependencies [[`5bfd630`](https://github.com/valbuild/val/commit/5bfd630b63dee2189e238f20fe72ecc5537160f7), [`ccbcda6`](https://github.com/valbuild/val/commit/ccbcda60b3e3c465071229ae1ba28ac735483e63), [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a), [`5c18c99`](https://github.com/valbuild/val/commit/5c18c99ecc84651f82123481fc042063db953833), [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f)]:
  - @valbuild/shared@0.126.0
  - @valbuild/server@0.126.0
  - @valbuild/core@0.126.0
  - @valbuild/language-server@0.126.0

## 0.125.0

### Patch Changes

- [#638](https://github.com/valbuild/val/pull/638) [`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90) Thanks [@freekh](https://github.com/freekh)! - Val now runs on TanStack Start.

  `@valbuild/tanstack` is a new package with everything `@valbuild/next` has: Val
  Studio at `/val`, the on-page overlay and canvas, draft mode, the client hooks,
  server-side content reads, images, and the MCP tools.

  ```sh
  npm install @valbuild/tanstack
  ```

  ```ts
  // val.config.ts
  import { initVal } from "@valbuild/tanstack";
  const { s, c, config, tanstackRouter } = initVal({ project: "org/project" });
  ```

  **Routes are first class.** A Val module for a route is named after the route
  file it sits beside — `src/routes/posts.$postId.tsx` is served content by
  `src/routes/posts.$postId.val.ts` — and its keys are the URLs that route serves:

  ```ts
  export default c.define(
    "/src/routes/posts.$postId.val.ts",
    s.router(tanstackRouter, s.object({ title: s.string() })),
    { "/posts/hello-world": { title: "Hello world" } },
  );
  ```

  `.` and `/` both separate segments, `$param` is a parameter, `$` is a splat, and
  `index`, `route`, `(groups)` and `_pathless` layouts add no URL segment — the
  same rules TanStack Router uses for the route file itself. Val validates every
  key against that pattern, and Val Studio shows these modules as a sitemap under
  **Pages**, where an editor can add a page.

  Point the route generator away from your content files, in `vite.config.ts` and
  `tsr.config.json`:

  ```ts
  tanstackStart({ router: { routeFileIgnorePattern: "\\.val\\.[tj]sx?$" } });
  ```

  See the [README](https://github.com/valbuild/val/blob/main/packages/tanstack/README.md)
  for the full wiring, and `examples/tanstack` for a working app.

  **Also fixed, for everyone:** `Internal.VERSION.core` was `null` in any ESM
  bundle — it was read with `require("../package.json")` inside a `try`, so the
  failure was silent. That version goes into every remote file ref and proxy mode
  refuses to start without it. Every package now reads its version through a
  static JSON import, which is inlined at build time.

  Two smaller fixes that came out of running the whole toolchain against a
  TanStack project:

  - `val versions` reports `@valbuild/tanstack`, and `val debug` writes a snapshot
    that names whichever framework package the captured project actually has.
  - `@valbuild/eslint-plugin` reads a `tsconfig.json` that has comments in it. A
    tsconfig is JSONC, and `JSON.parse` is not — so on any project whose tsconfig
    carries a comment (the TanStack starter's does) the
    `module-in-val-modules` rule threw `Expected double-quoted property name in
JSON` on the first file and took the whole lint run with it.

  Three fixes found by driving the Studio against a real TanStack app:

  - **A draft image now loads on the page.** The source the Studio pushes to the
    host page carries `patch_id` for any file whose bytes are still in a patch, so
    the page asks `/api/val/files/...?patch_id=` rather than a `/public` path that
    nothing has written yet. This was silent — the image just did not appear — and
    it affects any page that reads media through the hooks rather than on the
    server, `@valbuild/next` included.
  - **A splat route no longer logs an error on every render.** TanStack returns
    both `_splat` and `*` for the same parameter; Val reported the second as a
    parameter it could not place in the path.
  - The TanStack example and starter render a 404 page instead of throwing
    `notFound()` from a component, which escaped to the error boundary and logged
    `Error in renderToReadableStream` (and, with no not-found component
    configured, aborted the response) on every miss.

- Updated dependencies [[`22f78b4`](https://github.com/valbuild/val/commit/22f78b471fd18e542f518f72b75bd472d7c3dc52), [`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90)]:
  - @valbuild/language-server@0.125.0
  - @valbuild/core@0.125.0
  - @valbuild/shared@0.125.0
  - @valbuild/eslint-plugin@0.125.0
  - @valbuild/server@0.125.0

## 0.124.0

### Patch Changes

- Updated dependencies [[`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055), [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055), [`aa89fc2`](https://github.com/valbuild/val/commit/aa89fc26de7028b3c5a1666b99afc03b39e92769)]:
  - @valbuild/server@0.124.0
  - @valbuild/shared@0.124.0
  - @valbuild/core@0.124.0
  - @valbuild/language-server@0.124.0

## 0.123.3

### Patch Changes

- Updated dependencies [[`4c9369b`](https://github.com/valbuild/val/commit/4c9369bad3f17e96868262e78a4f47361d85319e), [`fb1baff`](https://github.com/valbuild/val/commit/fb1baffead5228d8a86a51af65178b88738d5a64), [`accf4f8`](https://github.com/valbuild/val/commit/accf4f852fe3400d762cc14e80316da741a69a9a), [`aef45ce`](https://github.com/valbuild/val/commit/aef45ce3ef269f1b6221de44a56df0f6a0d9dbbd)]:
  - @valbuild/server@0.123.3
  - @valbuild/language-server@0.123.3
  - @valbuild/shared@0.123.3

## 0.123.2

### Patch Changes

- Updated dependencies [[`04b6d4c`](https://github.com/valbuild/val/commit/04b6d4cbbecc131bbaf3c20633af9dad8c857310), [`8e58c34`](https://github.com/valbuild/val/commit/8e58c3495d1bf0f221a57082cb0a3045929722a1)]:
  - @valbuild/shared@0.123.2
  - @valbuild/server@0.123.2
  - @valbuild/language-server@0.123.2

## 0.123.0

### Patch Changes

- Updated dependencies [[`c5e7dfd`](https://github.com/valbuild/val/commit/c5e7dfd12aa1371195be642e1c2fb72b6f3e3ce2), [`53f670c`](https://github.com/valbuild/val/commit/53f670c0cf2d7a03a6d068c78b7874ce77652c2a)]:
  - @valbuild/server@0.123.0
  - @valbuild/shared@0.123.0
  - @valbuild/language-server@0.123.0

## 0.122.0

### Patch Changes

- Updated dependencies [[`be32261`](https://github.com/valbuild/val/commit/be32261af19db8018bc37b180d903416018c0b79), [`5d14612`](https://github.com/valbuild/val/commit/5d14612f612d657a37338136188f2b3c02b28fe7), [`da6794f`](https://github.com/valbuild/val/commit/da6794f3dbd77d49ccfe780b359bab1689ee1b11)]:
  - @valbuild/server@0.122.0
  - @valbuild/shared@0.122.0
  - @valbuild/language-server@0.122.0

## 0.121.0

### Minor Changes

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

- Updated dependencies [[`2bcc6fd`](https://github.com/valbuild/val/commit/2bcc6fdff8d668123e07e3c5e81ac6fa1436e47b), [`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2), [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79)]:
  - @valbuild/shared@0.121.0
  - @valbuild/server@0.121.0
  - @valbuild/core@0.121.0
  - @valbuild/language-server@0.121.0

## 0.120.4

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.120.4
  - @valbuild/language-server@0.120.4

## 0.120.3

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.120.3
  - @valbuild/language-server@0.120.3

## 0.120.2

### Patch Changes

- [#593](https://github.com/valbuild/val/pull/593) [`095ee0d`](https://github.com/valbuild/val/commit/095ee0dd011b069c30bc99ae58356e28796e106b) Thanks [@freekh](https://github.com/freekh)! - Publish the packages that 0.120.1 did not reach.

  `@valbuild/server@0.120.1` made it to npm, but `@valbuild/cli`,
  `@valbuild/language-server` and `@valbuild/next` did not — the release job
  failed part-way through, and the version numbers it had already claimed could
  not be reused. This release carries the same contents for those three packages:
  they pick up the MCP signing-key rotation fix from `@valbuild/server@0.120.1`,
  and there is nothing else in it.

  If you are on 0.120.0, upgrade straight to this version. There is no 0.120.1 of
  these three packages, and there will not be one.

- Updated dependencies [[`095ee0d`](https://github.com/valbuild/val/commit/095ee0dd011b069c30bc99ae58356e28796e106b)]:
  - @valbuild/language-server@0.120.2

## 0.120.1

### Patch Changes

- Updated dependencies [[`6f318d4`](https://github.com/valbuild/val/commit/6f318d406295b772e721bf463283f47e2822e996)]:
  - @valbuild/server@0.120.1
  - @valbuild/language-server@0.120.1

## 0.120.0

### Patch Changes

- Updated dependencies [[`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a)]:
  - @valbuild/core@0.120.0
  - @valbuild/shared@0.120.0
  - @valbuild/language-server@0.120.0
  - @valbuild/server@0.120.0

## 0.119.0

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.119.0
  - @valbuild/language-server@0.119.0

## 0.118.0

### Patch Changes

- Updated dependencies [[`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95)]:
  - @valbuild/server@0.118.0
  - @valbuild/shared@0.118.0
  - @valbuild/language-server@0.118.0

## 0.117.1

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.117.1
  - @valbuild/language-server@0.117.1

## 0.117.0

### Patch Changes

- Updated dependencies [[`fca3efa`](https://github.com/valbuild/val/commit/fca3efa389e2817401f55ea3dd184af7c611b807), [`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f), [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d)]:
  - @valbuild/server@0.117.0
  - @valbuild/language-server@0.117.0
  - @valbuild/core@0.117.0
  - @valbuild/shared@0.117.0
