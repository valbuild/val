---
"@valbuild/core": patch
"@valbuild/ui": patch
---

A guided tour of the Studio, and a `studio.tour` setting to turn it off

Editors kept asking what Pages, Media and Data are for. The three words are
precise inside Val and vague everywhere else, and the Studio said each of them
in three places — the rail tooltip, the panel header, the empty state — without
ever defining any.

**A guided tour**, offered by a glowing "Take a tour" button on the empty editor
at `/val/~` and kept permanently in **Quick actions**: welcome, then Pages, Media
and Data where the project has them, then the assistant where there is one, then
Review, Preview and Publish. It never opens itself, and the glow stops for good
once somebody has been through it on that browser.

Turn it off for the whole project under **Settings → Studio** — a new
`studio.tour` field on `s.settings()`, unset meaning the tour is offered. A team
that finds it noisy switches it off once, for everyone, instead of each person
dismissing it on each machine; the tour stays in Quick actions for anyone who
wants it.

Also, for the same first-run problem:

- **Rail tooltips carry a definition** under the label: "The pages of your site,
  by URL", "Shared images and files, uploaded once", "Content that is not tied
  to one page".
- **The empty editor is a short glossary** of the destinations this project
  actually has, rather than "No item selected".
- **Empty states explain instead of reporting.** "No pages yet" now says who
  creates the routes pages go under; "No galleries yet" says what a gallery is
  for.
- **A project with a single media gallery opens it**, so Media shows media
  instead of one collapsed row named after a module file.
- **A site map of twenty pages or fewer arrives open.** With a home page at `/`
  the whole site nests under one root row, so Pages used to show a single row
  called Home. Larger sites keep the old behaviour.
- **Settings points at Account** for the per-person settings — the theme, and
  how the Studio behaves on this machine.
- Page rows with children now carry `aria-expanded`, as the media panel's rows
  always did.
