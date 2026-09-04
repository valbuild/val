# @valbuild/ui

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
