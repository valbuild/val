# @valbuild/ui

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
