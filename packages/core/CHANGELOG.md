# @valbuild/core

## 0.126.0

### Minor Changes

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

### Patch Changes

- [#661](https://github.com/valbuild/val/pull/661) [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f) Thanks [@freekh](https://github.com/freekh)! - Every schema method now has a worked `@example` in its JSDoc, so hovering it in
  your editor shows what to write.

  That covers the whole builder surface — `.describe()`, `.validate()`,
  `.nullable()`, `.readonly()`, `.hidden()`, `.preview()`, `.render()`, and the
  per-type methods such as `.minLength()`, `.regexp()`, `.raw()`, `.multiline()`,
  `.from()` / `.to()`, `.remote()`, `.jsonValues()` and `.external()` — as well as
  `c.define()`, `c.json()`, `c.external()` and the `val` helpers (`val.attrs`,
  `val.raw`, `val.unstable_getPath` and friends).

  One of the examples corrected a real trap: a custom validator returns
  `false | string`, so the natural-looking

  ```ts
  s.string().validate((val) => val.trim() === val || "No surrounding spaces");
  ```

  does not type check — `||` yields `true`, and `true` is not one of the two
  answers. Write it as a ternary instead:

  ```ts
  s.string().validate((val) =>
    val.trim() === val ? false : "No surrounding spaces",
  );
  ```

  The examples are checked in CI, not just written: one test asks the TypeScript
  checker for the doc each method actually resolves to and fails if it has no
  `@example`, and another compiles every example it finds.

## 0.125.0

### Minor Changes

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

## 0.124.0

### Minor Changes

- [#622](https://github.com/valbuild/val/pull/622) [`aa89fc2`](https://github.com/valbuild/val/commit/aa89fc26de7028b3c5a1666b99afc03b39e92769) Thanks [@freekh](https://github.com/freekh)! - **Breaking:** `s.images()` and `s.files()` no longer take a `remote` option. Use
  `.remote()`, the same way `s.image()` and `s.file()` already did.

  ```ts
  // before
  s.images({ directory: "/public/val/images", remote: true });
  s.files({
    directory: "/public/val/docs",
    accept: "application/pdf",
    remote: true,
  });

  // after
  s.images({ directory: "/public/val/images" }).remote();
  s.files({
    directory: "/public/val/docs",
    accept: "application/pdf",
  }).remote();
  ```

  Behaviour is unchanged — remote is still off unless asked for. This only makes
  remote one thing spelled one way across all four media schemas, instead of an
  option on the two collections and a method on the two fields. `remote: false`
  has no replacement because it was the default; drop it.

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

- [#607](https://github.com/valbuild/val/pull/607) [`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2) Thanks [@freekh](https://github.com/freekh)! - `.readonly()` and `.hidden()` now take the flag as an argument, so a schema can
  decide these from a variable instead of only from whether the call was written at
  all:

  ```ts
  s.string().readonly(!canEdit);
  s.image().hidden(hideMedia);
  ```

  The argument defaults to `true`, so `.readonly()` and `.readonly(true)` are the
  same thing and nothing about existing schemas changes. Passing `false` leaves the
  field editable or visible, which is also what a schema is without the call - it
  is there so the flag can come from a variable.

## 0.120.0

### Minor Changes

- [#589](https://github.com/valbuild/val/pull/589) [`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a) Thanks [@freekh](https://github.com/freekh)! - **Breaking:** `s.richtext()` options are flat.

  The `style`, `block` and `inline` groups are gone — every option is a key of its
  own. The names are unchanged, so updating a schema is only a matter of removing
  the wrappers:

  ```ts
  // before
  s.richtext({
    style: { bold: true, italic: true },
    block: { h1: true, ul: true },
    inline: { a: true, img: s.image() },
  });

  // after
  s.richtext({
    bold: true,
    italic: true,
    h1: true,
    ul: true,
    a: true,
    img: s.image(),
  });
  ```

  The groups never carried any meaning the option names did not already have, and
  they cost something real: an option name and its `ValRichText` theme key were
  spelled differently (`block.h1` vs `theme.h1`), so the type that keeps a theme
  exhaustive had to restate all thirteen options by hand. It is now a mapped type
  over the options themselves — which also fixes an inconsistency in it: enabling
  links with a schema (`a: s.route()`) rather than `a: true` now requires an `a`
  key in the theme, the way `img` always has.

  `ValRichText` themes were already flat and are unchanged. The serialized schema
  that the server sends the Studio is flat too, so a project must not mix
  `@valbuild/*` versions across this release.

## 0.117.0

### Patch Changes

- [#581](https://github.com/valbuild/val/pull/581) [`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f) Thanks [@freekh](https://github.com/freekh)! - Images no longer show a validation warning in the editor when nothing is wrong
  with them.

  Every `s.image()` carrying width, height or a mime type used to be marked in VS
  Code with "Found image metadata, but it could not be validated", whether or not
  the metadata was correct — so the warning sat on every image in the project and
  never went away, not even after applying its own quick fix.

  That message was never a finding. `@valbuild/core` cannot read files, so it
  cannot answer whether stored dimensions match the image, and it hands the
  question on as an `image:check-metadata` fix instead. `val validate` has always
  resolved that by reading the file and comparing; the language server now does
  the same, and reports only what actually disagrees:

  ```
  Image width is incorrect! Found: 800. Expected: 944
  ```

  An image whose metadata is right gets nothing. A missing `width`, `height` or
  `mimeType` is reported, as is a stale one, with the quick fix still offered. A
  file that is not on disk is still reported as a missing file rather than as a
  metadata problem.

  The four messages involved say what they mean now, in the editor and in
  `val validate` alike:

  - "Image metadata has not been checked against the file." (was "Found image
    metadata, but it could not be validated. An image must have a width (positive
    number), a height (positive number) and a mime type." — which described a
    check that never ran)
  - "Image metadata is missing: width, height and mimeType." (was "Could not
    validate Image metadata.")
  - "File mimeType has not been checked against the file." (was "Found mimeType,
    but it could not be validated.")
  - "File metadata is missing: mimeType." (was "Missing File mimeType.")

  Also fixes an `s.file()` whose `mimeType` is missing: it reported "Mime type and
  file extension not matching. Mime type is 'undefined'" with no fix attached, so
  no quick fix was offered and the `file:add-metadata` case was unreachable. It
  now reports the missing mime type and offers to add it.

- [#579](https://github.com/valbuild/val/pull/579) [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d) Thanks [@freekh](https://github.com/freekh)! - Every release now ships a changelog. Each package's `CHANGELOG.md` records what
  changed under the version that shipped it — with a link to the pull request, the
  commit and the author — and the same entry becomes the body of the GitHub
  Release for the tag. The file is included in the npm tarball, so it is also
  readable from an installed copy.

  Up to now those changelogs were generated empty, and the GitHub Releases with
  them, so there was no record of what any given version contained. Releases from
  this one on have one; earlier versions stay blank.
