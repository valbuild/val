# @valbuild/ui

## 0.122.0

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
