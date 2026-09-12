# @valbuild/ui

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

- [#664](https://github.com/valbuild/val/pull/664) [`719ad6b`](https://github.com/valbuild/val/commit/719ad6b607bcf136d0dbde9e90bf4b8a843561a4) Thanks [@freekh](https://github.com/freekh)! - Recent activity now shows publishes, not just edits

  The Studio's Recent activity list only ever showed unpublished edits. Publishes
  lived in the status bar's deploy feed, which is a live-progress indicator — it
  closes itself once a build lands, and rows can be dismissed — so as soon as a
  publish had finished, nothing in the Studio said it had.

  Publishes are now rows in the same list, interleaved with the edits by time, so
  the panel reads as what happened here: you changed the hero, it went out, a
  colleague changed the pricing. A publish row carries the commit message (or the
  short sha when there is none), who published it, and how the build is doing —
  with the same labels and the same spinner/warning icons the deploy feed uses, so
  one publish never reads two ways in two places.

  Edits stay clickable and open the field they changed; a publish is a commit and
  opens nothing, so it renders as a line rather than a button. Publishes take at
  most three of the eight rows: an afternoon of publishing must not push out the
  edits the panel exists to get you back to, and the full feed is still in the
  status bar.

- [#664](https://github.com/valbuild/val/pull/664) [`9830277`](https://github.com/valbuild/val/commit/9830277e9aaca8da3030f629c2656ec58da47e45) Thanks [@freekh](https://github.com/freekh)! - "All changes saved", not "All changes saved locally"

  The status bar's resting state claimed changes were saved _locally_, at every
  breakpoint and in both modes. Against a project that is wrong: the patch is on
  the content service, which is where it has to be for a colleague to see it and
  for Publish to ship it. "Locally" reads as "still only on this machine" — the
  one thing an editor would want to know, said backwards.

  It is not worth saying in local dev either, where the bar already shows "Dev
  mode" and the branch a couple of items to the left.

- [#664](https://github.com/valbuild/val/pull/664) [`64bfd0a`](https://github.com/valbuild/val/commit/64bfd0a6c85832ea5169b53e47087f22e193df36) Thanks [@freekh](https://github.com/freekh)! - The canvas no longer covers the page to say preview mode is off

  Whenever the canvas could not do its job, a panel with a blurred backdrop
  covered the whole frame. That stopped the canvas being a canvas: the published
  page underneath is real and worth reading and scrolling, and none of it was
  reachable behind an explanation of why it could not be _edited_. And because
  the panel also appeared during ordinary slowness — a first `next dev` compile of
  a route, the enable redirect in flight — the normal path to a working canvas ran
  through a screen that looked like a failure.

  It is a small pill at the top of the canvas viewport now, with the page
  untouched behind it. For the first twenty seconds it shows a spinner and says
  only that the preview is not ready yet; after that it turns into a warning, with
  warning colours, and names what is actually wrong — "Preview mode is off" or "No
  answer from the page".

  "Turn on preview mode" is on the pill itself, as soon as there is something to
  turn on — it is the one thing most people here need, and it is one click. The
  explanation, "Reload" and the developer's setup checklist are behind a "Details"
  disclosure, so nobody has to read a wiring guide to look at their page.

- [#664](https://github.com/valbuild/val/pull/664) [`7782979`](https://github.com/valbuild/val/commit/7782979e9b52f2015a6e72dc981e630d4f8c78e2) Thanks [@freekh](https://github.com/freekh)! - The deploy feed is the last few publishes, with no rows to dismiss

  Every row in the deploy list carried a dismiss button, and the shell and the
  provider each kept a set of dismissed commits to subtract from the feed. That
  control existed because the list grew: the client accumulated every deployment
  and commit a session had ever seen, so a tab left open all day ended up with a
  list only clearing could shorten.

  The feed is bounded now — the content service returns the most recent publishes,
  and the client keeps the newest few of those — so there is nothing to tidy: what
  a row would be dismissed for is that it is old, and being old is what takes it
  off the end of the list on its own. The list still closes on its own once
  everything has landed, on Escape, and on a click outside.

  One behaviour follows from the feed carrying history: the list no longer opens
  itself for an old publish. It used to treat anything Val had not seen serving
  the site as news, which was true when the feed only held the publishes on the
  current chain — now that it holds the last few, "not live" is the resting state
  of every publish that has been superseded, and opening Val would have announced
  a build from last week. Freshness decides it instead.

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

- [#667](https://github.com/valbuild/val/pull/667) [`755e1a3`](https://github.com/valbuild/val/commit/755e1a3953775cb8d2c2dce87d6810d3dc329640) Thanks [@freekh](https://github.com/freekh)! - An empty image description is no longer marked as an error

  The Description field of an image field showed a red **Missing** next to it
  whenever it was empty. Val has no rule that alt text is required, so nothing in
  validation reports that — the badge claimed an error the validator never
  raises, on every image field that had not been given a description. It is gone.
  If a schema ever does require alt text, that arrives through the ordinary
  validation error path, which the field already shows.

  The **Use the filename** shortcut next to it is gone with it. It only ever
  appeared alongside the badge, and a filename says what the file is called
  rather than what the picture shows, which is the one thing the field is asking
  for.

- [#660](https://github.com/valbuild/val/pull/660) [`c6b1ec8`](https://github.com/valbuild/val/commit/c6b1ec84f1883750a4cfe5f70470b177621e971f) Thanks [@freekh](https://github.com/freekh)! - Surfaces in the Studio paint the colour they name

  Four places named a colour from shadcn's compatibility block — `bg-card`,
  `bg-primary-foreground`, and a gradient's stops. None of those tokens is
  declared anywhere the Studio can see them: they live under `:root` and `.dark`,
  and the Studio renders inside a shadow root (where `:root` matches nothing)
  with `darkMode` set to `[data-mode="dark"]` (so `.dark` never matches either).

  The effect is quiet, which is why it lasted: an undefined colour is invalid at
  computed-value time, so the element simply paints nothing and shows whatever is
  behind it. The record list's rows had no background at all, and the fade over a
  truncated list row computed to a gradient from transparent to transparent —
  no fade.

  They now name the Studio's own tokens. Nothing changes colour: each surface was
  already showing the page background through the hole, which is the colour it
  now paints deliberately — except the truncation fade, which appears again.

  `surfaceTokens.test.ts` holds the line, alongside the focus-ring test that
  covers the same trap for `box-shadow`. It reads the dead tokens out of
  `index.css`, so reviving one lifts the ban on it automatically. The vendored
  `components/designSystem/` copies of shadcn are out of scope and still name the
  dead tokens.

- [#664](https://github.com/valbuild/val/pull/664) [`656f680`](https://github.com/valbuild/val/commit/656f680043c640f678625a64e690389ab23a0a69) Thanks [@freekh](https://github.com/freekh)! - Move the assistant button to the bottom bar on mobile

  On a phone the Sparkles button sat in the top right of the top bar, sharing
  that corner with the navigation menu, History, notifications and the account
  avatar — the furthest point on the screen from a thumb, and the row you reach
  for least.

  It is now in the sticky bottom bar, beside Quick actions, where Preview and
  Publish already are. The top bar drops its own button below the mobile
  breakpoint, so there is still exactly one way in rather than two places to look
  for the same panel. Nothing changes on tablet or desktop, and a project with no
  assistant configured shows no button in either place.

- [#664](https://github.com/valbuild/val/pull/664) [`610a041`](https://github.com/valbuild/val/commit/610a0414b120b521f38a2eb1182b3778bf778b2b) Thanks [@freekh](https://github.com/freekh)! - Review stays in the top bar with nothing pending, and says so

  Above the mobile breakpoint — a phone reaches Review through Quick actions, and
  still does — the Review button was hidden whenever nothing was pending: present
  in the layout so the bar would not reflow, but unreachable and invisible to
  screen readers. That made "is anything of mine still unpublished?" unanswerable from
  the top bar: a hidden button and a button whose data has not loaded yet look
  exactly the same, so the only way to find out was to publish and see what
  happened. The Quick actions row on a phone already answered it; the bar now
  does too.

  Opening it with nothing pending gives a real screen instead of the single grey
  "No pending changes." line: it says the editor and the published site agree, and
  what the view will show once they do not. The wording follows the mode, so a
  local dev project is told about its working tree rather than about publishing.

  The change count is still a badge that only appears when there is one, so an
  empty Review reads as "nothing pending" rather than as "0 changes".

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

- [#635](https://github.com/valbuild/val/pull/635) [`5674237`](https://github.com/valbuild/val/commit/56742371a75b4fdcbff8b1afccff8fcc1ebf8078) Thanks [@freekh](https://github.com/freekh)! - Find your history from the Studio, instead of building a URL by hand

  The two-pane history view shipped with no way in. Everything behind it worked —
  the commit archives, the reconstruction, the compare, the restore — but the
  only way to reach it was to read a commit sha out of the database and assemble
  a query string yourself. A feature nobody can find is not shipped.

  There is now a **History** button in the top bar, next to Publish. It lists what
  has been published on this branch, newest first, with the message, who published
  it, when, and how many changes it carried. Click one and it opens beside the
  Studio; **Stop comparing** closes it again.

  - Commits made before Val recorded history — and ones pushed straight to the
    repo — are listed, but greyed out and not clickable, with a note saying why.
    Hiding them would make your history look shorter than it is.
  - **Load more** pages back through older commits.
  - The button does not appear in local development, where there is no published
    history to list.

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

## 0.123.3

### Patch Changes

- [#634](https://github.com/valbuild/val/pull/634) [`356eb11`](https://github.com/valbuild/val/commit/356eb11b5f6a0a02dfec80580c6fccac75d28402) Thanks [@freekh](https://github.com/freekh)! - Publish the AI summary that arrived while you were waiting for it

  Pressing Publish while the AI was still writing the commit message starts a
  short countdown, so the summary gets a chance to land before the commit goes
  out. It landed — the box on screen filled with it — and then the commit said
  "Update Home" anyway.

  The text was read back out of the summary state by the publish button, from
  that button's own render. The countdown fires a callback created when Publish
  was pressed, and applying the summary and ending the wait happen in the same
  flush, so the callback always ran with the text the box held _before_ the
  summary arrived. No amount of waiting could have fixed it.

  The popover now hands the text to publish along with the request, and works it
  out from the values as they are at that moment. The rule is unchanged and is
  still the one thing this flow guarantees: an AI summary takes over only a box
  nobody has typed in, so anyone who wrote their own summary publishes exactly
  what they wrote, whenever the AI happens to answer.

## 0.123.2

### Patch Changes

- [#630](https://github.com/valbuild/val/pull/630) [`3e93508`](https://github.com/valbuild/val/commit/3e93508b05d08b0c24947a97c6141a9ad8a3931e) Thanks [@freekh](https://github.com/freekh)! - Two fixes to the Studio's chrome

  **Data, Media and Settings are reachable again on a tablet.** The left rail is
  drawn from 1200px up, and the top bar's menu button opens the first destination
  a project has and nothing else — so between 768px and 1200px, which is an iPad
  in either orientation and any half screen, whichever panel happened to be open
  was the only panel you could reach. The destination switcher that stands in for
  the rail was shown below 768px only, and the tablet width fell through the gap
  between the two. It is now shown at every width where the rail is not.

  **Review moved to the left of Preview.** The three actions read left to right
  in the order they are done in — Review, Preview, Publish — instead of putting
  the first step between the other two.

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

- [#597](https://github.com/valbuild/val/pull/597) [`1c8b7fd`](https://github.com/valbuild/val/commit/1c8b7fda1e84cd8bd32a03a85d2789598b98c3fb) Thanks [@freekh](https://github.com/freekh)! - Studio: a calmer light mode.

  Light mode was built on full white. Panels, the rail, the bars and every field
  surface were `#ffffff`, and the canvas behind them sat 4% below that — so the
  Studio filled the viewport with one bright sheet, and the floating layout had
  almost no light to distinguish its layers with.

  Every neutral surface now sits one step down the ramp: floating chrome and
  fields at `#fcfcfc`, the canvas at `#f4f4f5`, raised and hover fills at a new
  `#eeeef0`. Nothing large is pure white any more. The luminance gap between a
  panel and the canvas roughly doubles, so panels read as floating rather than as
  part of the page while the chrome gives off noticeably less light.

  The panel hairline and muted text came down a nudge with the surfaces, because
  on a softer background the old values read washed out rather than quiet. Every
  foreground/background pair the chrome renders still meets WCAG AA, and with
  more headroom than before — `contrast.test.ts` holds that.

  Dark mode is unchanged.

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

- [#609](https://github.com/valbuild/val/pull/609) [`105479b`](https://github.com/valbuild/val/commit/105479b84a08846f1fe5971916f6a54275198d12) Thanks [@freekh](https://github.com/freekh)! - Studio: the focus ring on a dropdown's search field now runs the full width of the box.

  A ring is a `box-shadow`, so it is drawn around whatever element carries it — and the search input is not the search field you see. It starts after the magnifier icon and stops short of the row's padding, so the ring was a rectangle floating inside the popover with a gap down each side. It is on the row now, edge to edge, with its top corners following the box's own radius.

- [#595](https://github.com/valbuild/val/pull/595) [`55ec736`](https://github.com/valbuild/val/commit/55ec73651394908b6f440e360d181b95a91c0a93) Thanks [@freekh](https://github.com/freekh)! - Show your own name on the changes you have just made.

  In a hosted project, a change made in the Studio showed up under "Unknown
  author" as soon as it was made, next to earlier changes that were correctly
  attributed. Reloading the page fixed it, which is what made it look arbitrary:
  whether a change had an author depended on whether it had been fetched from the
  server or made in the tab you were looking at.

  A patch created in the browser carried no author at all. The server stamps one
  from your session when the patch is saved, but the Studio never re-fetches a
  patch it made itself, so nothing in the tab ever learned who wrote it — the
  change history, the author avatars on a field and the review screen all grouped
  it under an author they could not name.

  Such a patch is now stamped with the current profile as it is created, which is
  the same author the server records for it.

- [#604](https://github.com/valbuild/val/pull/604) [`2db27d5`](https://github.com/valbuild/val/commit/2db27d555441bee2dd31817acc8c92b7b718ee55) Thanks [@freekh](https://github.com/freekh)! - Studio: duplicate a page, publish feedback on a phone, and a batch of visual fixes.

  **Duplicate a page.** A page can be copied to a new URL from two places: the
  Copy button beside its title, and a Copy button on its row in the Pages panel.
  Both open the same route form the New page and Change URL controls use,
  prefilled with the page's own URL, so the usual answer is one segment away — and
  both go through one `copy` patch op, so the copy is the page rather than
  somebody's second idea of what a page contains. Media comes along by reference:
  duplicating a page with a gallery on it does not re-upload the gallery.

  **Publishing from a phone says something.** The mobile bottom bar takes the row
  the status bar would have had, so the deploy feed lived only inside the settings
  sheet: the Publish button went back to "Publish" and that was the whole of the
  feedback, with no way to tell a push that had landed from one that never went
  out. The list now appears above the bottom bar when a publish goes out, and
  closes itself once everything is live.

  **Review is always in the quick actions.** It appeared only when something was
  pending, which left "is anything of mine still unpublished?" unanswerable on a
  phone — an empty row of quick actions looks the same as one that has not loaded.

  **The compare view fits on a phone.** One long line used to scroll the whole
  review sideways, and a long value pushed everything after it off the bottom.
  Each compare box now scrolls its own content, and a read-only value in a dense
  row is text rather than a disabled input — so a line longer than the box wraps
  instead of being clipped at the right edge with no way to reach the rest.

  **Author pictures show up everywhere they should.** The Studio had five ways to
  draw a person, and the one in the top bar, the rail and the account panel drew
  initials only — so the same author looked like two different people depending on
  which surface you were on. There is one now, and it shows the profile picture
  wherever there is one, falling back to initials.

  Also:

  - The AI chat keeps the caret in the composer when an answer completes. The
    composer is made non-editable while the assistant is answering, which drops
    the focus, and nothing put it back — so every follow-up question started with
    a click.
  - A long tool name in the AI chat's tools row no longer pushes the row off to
    the right. Radix's scroll areas size their content as a table, which makes
    `truncate` grow the row to the full untruncated width instead of clipping it.
  - A focused combobox no longer draws its highlight outside itself. The focus
    ring is painted outside the border box, so on a full-width trigger — and on
    the search input inside the dropdown — it landed on the enclosing field and
    was clipped or drawn over the box's own border.
  - The deployments list no longer pops open for a publish that has been serving
    the site for more than ten minutes. It opens for a commit it has not seen
    before, which could not tell a publish that just happened from one that
    finished before the tab existed.

## 0.120.4

### Patch Changes

- [#599](https://github.com/valbuild/val/pull/599) [`6df3cae`](https://github.com/valbuild/val/commit/6df3caec1cc043a07b532d3174583b8218d4871d) Thanks [@freekh](https://github.com/freekh)! - Add a referenced entry from a `s.keyOf()` field

  A `keyOf` field can now create the entry it is about to point at. Where the
  author you want is not in the authors record yet, name them here: the entry is
  added to the referenced record, the field points at it, and you are taken to the
  new entry to fill it in — instead of leaving the page you were editing to create
  it and coming back to link it.

  - Two ways in, as reference fields normally have: **New entry** at the foot of
    the dropdown, and a **+** beside it for when you have not opened the dropdown.
  - The key you searched for is what the new entry is named, and the option stays
    offered when the search matches nothing — which is how you got there.
  - The key box says what a key is here, from the record's `key` description (or
    the field's own).
  - A key that already exists is refused rather than overwriting that entry.
  - Where the field renders the entry inline, it stays put: the new entry's fields
    are already on screen.
  - Only for a record — an object's keys are its schema. A router record asks for
    the new key per route segment, the same form the sitemap's "Add page" uses.

## 0.120.3

### Patch Changes

- [#596](https://github.com/valbuild/val/pull/596) [`9b96184`](https://github.com/valbuild/val/commit/9b96184cf6ad6d52a714867fb1527eeec6c776f4) Thanks [@freekh](https://github.com/freekh)! - The AI model picker opens again, and shows even with one model on offer.

  Its menu was portalled to `document.body` — outside the shadow root the Studio
  renders in, where none of Val's styles reach it and nothing lifts it above the
  overlay. The menu did open; it was invisible behind the Studio, which reads as a
  trigger that does nothing. It now portals into the Studio's own container, like
  every other popup there.

  The picker also used to hide itself unless there were at least two models, so an
  account with one reachable model had nothing telling it which model was
  answering. It now renders whenever there is a model at all, and only disappears
  when there are none — which means AI is off, not that there is no choice.

  `DropdownMenuContent` now renders inline instead of portalling when it is given
  no container — the posture `TooltipContent` already took — so this cannot
  silently happen again: a clipped menu can be recovered from, an invisible one
  cannot.

- [#600](https://github.com/valbuild/val/pull/600) [`1a2484a`](https://github.com/valbuild/val/commit/1a2484a309679bd5e963d626466c2828f74d49f8) Thanks [@freekh](https://github.com/freekh)! - Fix dragging a list row on a phone, which picked the row up well below the
  finger and dropped it about three rows too far down.

  The card that follows your finger is positioned against the viewport, and on a
  phone the editor and the page ride on a track that was transformed even while it
  was standing still. A transformed box becomes the reference point for everything
  positioned that way inside it, so with the preview open the card was placed
  against a box already pushed down by the strip of switches — 132px of it. The
  same offset decided where the row landed, which is why the drop missed by
  roughly three positions.

  The track is now only transformed while it is actually moving between the
  editor and the page.

  Drag handles also declare `touch-action: none`, as dnd-kit asks them to. Without
  it a phone can decide mid-drag that your finger meant to scroll, and from that
  moment the drag and the list move at the same time. The rule had been written as
  an HTML attribute rather than as CSS, so it had never taken effect.

- [#601](https://github.com/valbuild/val/pull/601) [`71becc7`](https://github.com/valbuild/val/commit/71becc7e543432e4a57e36d54aaf803e9a447ffd) Thanks [@freekh](https://github.com/freekh)! - Fix the page going unclickable behind a stale selection box in the overlay's select mode.

  In select mode the overlay draws a box over whatever Val content the pointer is on, and that box is what turns a click into "edit this" — it sits above the page and stops the event. The box was only ever written when the pointer found tagged content, never cleared when it left, so it stayed parked over the last thing the pointer crossed. Everything under that rectangle stopped responding for as long as select mode was on: most visibly, a link there could not be followed.

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

## 0.119.0

### Minor Changes

- [#587](https://github.com/valbuild/val/pull/587) [`84165f7`](https://github.com/valbuild/val/commit/84165f743eb5802da1e8079bbe98eafcb2cdcec8) Thanks [@freekh](https://github.com/freekh)! - The AI assistant's tool calls are now a row of their own above the answer,
  collapsed to a summary you can expand.

  They used to be listed inside the assistant's own bubble, one line per call, so
  a turn that read a schema, searched, read a source and wrote a patch pushed its
  answer off the bottom of the panel — the part you were waiting for was the part
  you had to scroll for. The row now says what is happening ("Reading content…"
  while it runs, "Used 5 tools" when it is done) and the list is behind a
  disclosure.

  While a call is in flight its label shimmers, so the row shows the turn is
  still working without a spinner to stare at. It marks a call as pending, not as
  healthy: a stalled call stays pending, and goes on shimmering until the turn
  times out.

  `ask_user_question` cards stay outside the collapsible and always visible: the
  turn is blocked until one is answered, and hiding it leaves a session that has
  visibly stopped with nothing on screen saying why.

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

- [#574](https://github.com/valbuild/val/pull/574) [`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95) Thanks [@freekh](https://github.com/freekh)! - AI errors can now show what the provider actually said.

  The content server sends an optional `details` with a failed turn — provider,
  status, error type, request id and the provider's verbatim message — and the
  assistant puts it behind a "Details" disclosure. Closed by default, because it
  is for whoever is going to act on it; findable without a server log, which is
  the point.

- [#584](https://github.com/valbuild/val/pull/584) [`fe6a398`](https://github.com/valbuild/val/commit/fe6a3981691394e6f34d4d80ec17febd356a98cc) Thanks [@freekh](https://github.com/freekh)! - Fix `useCurrentAuthorId` throwing outside a `ValProvider`, which broke every render of the review screen in isolation.

## 0.117.1

### Patch Changes

- [#583](https://github.com/valbuild/val/pull/583) [`0ae7bac`](https://github.com/valbuild/val/commit/0ae7bac8a186460bc2b31f2ded89b00027bafb55) Thanks [@freekh](https://github.com/freekh)! - The Studio now links out to the project in Val Build.

  Val edits content; everything else about a project — who can edit it, its API
  keys, its versions, its subscription — lives at
  [admin.val.build](https://admin.val.build), and there was no way to get from
  one to the other. You had to know the URL, or find the project again from the
  front page.

  Two ways there now:

  - **The project name in the top bar is a link.** It opens the project's own
    page in Val Build, in a new tab, since leaving the Studio would mean leaving
    whatever is being edited in it.
  - **Settings has a Project section**, with **Administer project** — the same
    page — and **Manage members**, which opens the organisation's member list.

  Both hang off `project` in `val.config`, which is `"<org>/<project>"`. A
  project that has not been connected to Val Build — no `project`, or one that is
  not in that form — has no page to open, so the name stays a plain label and the
  Settings section is not shown at all, rather than offering a link that lands on
  a sign-in for an organisation you may not be in.

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
