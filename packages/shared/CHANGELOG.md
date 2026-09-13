# @valbuild/shared

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

- [#608](https://github.com/valbuild/val/pull/608) [`88262ac`](https://github.com/valbuild/val/commit/88262ac8db068650a664981ef73556457d87741a) Thanks [@freekh](https://github.com/freekh)! - Locale scopes: a subtree in one language, and one function that answers which.

  A **locale scope** is content governed by a single language. Two things open one
  today (a third, locale segments in routes, follows):

  ```typescript
  // a locale field: this object and everything below it is in one language
  s.object({ locale: s.locale(), title: s.string(), body: s.richtext() });

  // a locale-keyed record: each entry is in the language its key names
  s.record(s.locale(), s.object({ title: s.string() }));
  ```

  **A scope may not contain another scope**, and an object may have only one
  locale field. Both are reported as schema errors, naming what to move:

  ```
  An object can be in one language, so it can have one locale field.
  Found 'locale', 'language'.

  Everything here is already in one language, so 'byLanguage' cannot set
  another. Move the locale-keyed record out of this object, or take the outer
  one away.
  ```

  A scope three levels deep is reported once, by the scope immediately enclosing
  it, rather than by every ancestor.

  The rule is **validated rather than typed**. Expressing "no scope below this
  one" as a type constraint means threading it through every schema class's type
  parameter, and the errors a recursive constraint like that produces name the
  whole tree — an unrelated typo in a `.val.ts` would print pages.

  `localeAt(path, snapshot)` (from `@valbuild/shared/internal`) answers which
  language governs a path, and is the one implementation of that question, so the
  Studio, the server and the validation worker cannot disagree. It returns the
  tag, which is what `<html lang>`, `Intl` and `locales.available` all want.

  It answers `null` where no scope governs the path, where the project has
  declared no languages, and where a locale field holds something that is not one
  of them — validation is already reporting the last, and guessing would put a
  language in `<html lang>` that nobody chose.

### Patch Changes

- Updated dependencies [[`7fa8699`](https://github.com/valbuild/val/commit/7fa869974bc895af992a7d5c18b76253636d7d65), [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63), [`88262ac`](https://github.com/valbuild/val/commit/88262ac8db068650a664981ef73556457d87741a), [`7072e07`](https://github.com/valbuild/val/commit/7072e07623c953a09ac14388ae22dada0b431ce3), [`29811c3`](https://github.com/valbuild/val/commit/29811c3f8c7e001a950e6f4833af6888e6a4efea)]:
  - @valbuild/core@0.127.0

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

- [#659](https://github.com/valbuild/val/pull/659) [`ccbcda6`](https://github.com/valbuild/val/commit/ccbcda60b3e3c465071229ae1ba28ac735483e63) Thanks [@freekh](https://github.com/freekh)! - Discarding changes now clears the validation errors, previews and search results
  that were computed from them.

  A discard that removed a module's last pending change announced itself only as
  a "drop", and the stores that keep validation results, previews and the search
  index listened only for changes being applied. So after discarding, the Studio
  kept showing the errors and previews of the discarded edit until something else
  touched the module.

  Fields that reference another module's keys (`s.keyOf(...)` and `s.route()`)
  also follow that module now. Renaming a page and then discarding the rename left
  every `keyOf` field pointing at it reporting that the key does not exist — about
  a key that was back — because the module holding the reference had not changed
  and was never re-checked. The validation store now tracks which records a
  module's errors resolve against and re-checks it when their keys change, and only
  then: editing content inside a referenced page does not re-validate its
  referrers.

- Updated dependencies [[`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a), [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f)]:
  - @valbuild/core@0.126.0

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

### Patch Changes

- Updated dependencies [[`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90)]:
  - @valbuild/core@0.125.0

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

- Updated dependencies [[`aa89fc2`](https://github.com/valbuild/val/commit/aa89fc26de7028b3c5a1666b99afc03b39e92769)]:
  - @valbuild/core@0.124.0

## 0.123.3

### Patch Changes

- [#633](https://github.com/valbuild/val/pull/633) [`accf4f8`](https://github.com/valbuild/val/commit/accf4f852fe3400d762cc14e80316da741a69a9a) Thanks [@freekh](https://github.com/freekh)! - Stop `@valbuild/shared` replacing a consumer's own flexsearch types

  `@valbuild/shared` gained a flexsearch dependency in 0.123.0, for
  `search_content`, and typed its exported `SearchIndex.index` as flexsearch's
  own `Index`. That put `import { Index } from "flexsearch"` into the published
  `searchIndex.d.ts` — and flexsearch's type entry opens with
  `declare module "flexsearch"`, which is an AMBIENT module declaration and so
  global to a whole TypeScript program.

  The effect on a project that uses flexsearch itself, at a different version:
  its own calls are checked against the copy Val dragged in. valbuild/web pins
  flexsearch 0.7 and builds an index with
  `new flexsearch.Document({ language: "en", … })`; on `@valbuild/shared@0.123.2`
  that stopped compiling, because 0.8's `DocumentOptions` has no `language`. Its
  resolved copy was still 0.7 — only the types had been swapped underneath it.

  `SearchIndex.index` is now a structural type covering the three methods this
  package calls, so nothing in the published declarations names flexsearch. The
  library is still used to build the index; that is a value import, which never
  reaches a `.d.ts`.

  No API change: `SearchIndex` is still assignable from a real flexsearch
  `Index`, and `noFlexsearchInPublishedTypes.test.ts` asserts both halves of that
  — that no source file names flexsearch in a type position, and that a real
  `Index` still satisfies the stand-in, so it cannot drift from the library
  unnoticed.

- [#628](https://github.com/valbuild/val/pull/628) [`aef45ce`](https://github.com/valbuild/val/commit/aef45ce3ef269f1b6221de44a56df0f6a0d9dbbd) Thanks [@freekh](https://github.com/freekh)! - Stop the serialized-schema parser dropping schema metadata

  `SerializedSchema` in `@valbuild/shared` is a zod mirror of the serialized
  schema type, and its `z.object`s strip keys they do not declare. Five fields
  were declared on some schemas and forgotten on others:

  - `customValidate` — missing on twelve of the eighteen schemas. This is the flag
    that says a schema declares a `.validate()`; the function itself cannot
    serialize, so the flag is the only thing that tells the Studio to run the
    custom validators against the real instance.
  - `description` — missing on thirteen, so a `.describe()` went unseen.
  - `remote` and `referencedModule` — missing on `s.image()` and `s.file()`, so a
    remote field read as local and a gallery-backed field lost the gallery it
    reads its dimensions and mime type from.
  - the `message` on a `.regexp(pattern, message)` — so a field with a custom
    pattern message fell back to the generic "Expected string to match reg
    exp: …".

  Because it strips rather than rejects, nothing failed and nothing said so. The
  live `/schema` route was unaffected — `ValClient` validates the response and
  then returns the raw JSON — but the history path consumes the parsed output, so
  in a commit or historical patch-set view (`getModuleAtCommit`,
  `getHistoricalPatchSet`) a schema's custom validators, description, remoteness
  and backing gallery all quietly disappeared.

  The fields every serialized schema shares are now spread from one
  `commonSchemaFields` object instead of being retyped eighteen times, which is
  how they drifted apart in the first place. A round-trip test walks each schema's
  serialized output against the parsed result and fails with the path of any key
  that did not survive, so a field added to a serialized schema and forgotten in
  the parser is caught without anyone having to remember to assert it.

## 0.123.2

### Patch Changes

- [#629](https://github.com/valbuild/val/pull/629) [`04b6d4c`](https://github.com/valbuild/val/commit/04b6d4cbbecc131bbaf3c20633af9dad8c857310) Thanks [@freekh](https://github.com/freekh)! - Stop shipping zod to every visitor of a Val site (~113 KB)

  `@valbuild/next`'s client code needed five things from
  `@valbuild/shared/internal`, three of which are string constants like
  `VAL_THEME_SESSION_STORAGE_KEY`. But preconstruct publishes each entrypoint as
  a single bundled module, so importing a string constant pulled in the whole
  entrypoint — including `ApiRoutes.ts` and its zod schemas. Measured on
  val.build, that was 113 KB of zod in the initial JS of every page, for
  visitors who never open the Studio.

  Two changes:

  - New `@valbuild/shared/client` entrypoint carrying the parts that are safe in
    a browser bundle: the session-storage keys, the canvas protocol, and the
    route-pattern helpers. Nothing reachable from it may import zod, and
    `noZodInClientEntrypoint.test.ts` walks the source graph to enforce that —
    one careless re-export would silently put the 113 KB back.
  - `ValNextProvider` now imports `createValClient` on first use rather than at
    module scope. It genuinely needs zod (it `safeParse`s every request and
    response), but its only caller is the draft-mode poll, which returns early
    unless the overlay is mounted. A visitor without the Val Enable cookie never
    triggers the import.

  No API change. `@valbuild/shared/internal` still exports everything it did.

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

- [#620](https://github.com/valbuild/val/pull/620) [`53f670c`](https://github.com/valbuild/val/commit/53f670c0cf2d7a03a6d068c78b7874ce77652c2a) Thanks [@freekh](https://github.com/freekh)! - MCP: `search_content` — full-text search across the project's content, unpublished changes included.

  The same index the Studio's search box uses, moved into `@valbuild/shared` so both run it, and built fresh on every call. That was the part that looked expensive and is not: indexing `valbuild/web`, a real production site of 20 modules and 206 KB of source, takes 162 ms, and it scales linearly from there — the 10 s default deadline is not reached until roughly 13 MB of content. Loading the modules costs more than indexing them, and every tool call already pays that.

  That ratio between building the index and querying it — 162 ms against 0.2 ms — is why `queries` is a list. Everything expensive happens before the first query runs, so up to 20 of them are answered from a single pass, separately, so a caller can tell which of its guesses found the thing. A bare string still works as one query.

  It returns source paths, so `get_source` reads what it finds. The rest of the arguments narrow or bound the work:

  - `include` / `exclude` — module file path globs, e.g. `["/content/blogs/**"]`. `exclude` is applied after `include`.
  - `limit` — per query, defaulting to 100. A model filters a long list more cheaply than it asks again.
  - `timeoutMs` — stop indexing and answer with what has been indexed so far. The result then carries `timedOut`, the paths of the modules that were not reached, and a hint pointing at `include`.

  Every answer says what it actually searched (`searched: { modules, of }`), so each query's `total` can be read as a count over those modules rather than over the project. Modules you excluded are not reported as omissions — an omission always means the deadline, never your filter.

  `performSearch` now counts all the matches rather than the page it returns, which the Studio's result count gets too: FlexSearch stops as soon as it has the ids it was asked for, so a total taken from a page-sized search was only ever the page size again.

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

### Patch Changes

- [#618](https://github.com/valbuild/val/pull/618) [`da6794f`](https://github.com/valbuild/val/commit/da6794f3dbd77d49ccfe780b359bab1689ee1b11) Thanks [@freekh](https://github.com/freekh)! - Remove the unused `GET /api/val/session` endpoint.

  Nothing called it. The Studio reads the profile id from `/stat`, and in proxy
  mode the route proxied to `${VAL_BUILD_URL}/api/val/${project}/auth/session`,
  an upstream route that no longer exists — so calling it by hand returned a 500
  rather than a session. It is gone from both the route declarations in
  `@valbuild/shared` and the implementation in `@valbuild/server`.

  Session cookie handling itself is unchanged: `/authorize`, `/callback` and
  `/logout` still set and clear `val_session` as before.

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

- Updated dependencies [[`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2), [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79)]:
  - @valbuild/core@0.121.0

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

### Patch Changes

- Updated dependencies [[`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a)]:
  - @valbuild/core@0.120.0

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

## 0.117.0

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
