# @valbuild/core

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
