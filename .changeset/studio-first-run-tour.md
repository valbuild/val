---
"@valbuild/ui": patch
---

The Studio says what Pages, Media and Data actually mean — and offers a one-minute tour

Editors kept asking what the three destinations are for. Pages, Media and Data
are precise inside Val and vague everywhere else, and the Studio said each word
in three places (the rail tooltip, the panel header, the empty state) without
ever defining any of them.

- **Rail tooltips carry a definition** under the label: "The pages of your site,
  by URL", "Shared images and files, uploaded once", "Content that is not tied
  to one page".
- **Each navigation panel opens with one line saying what it is.** In the scroll
  area, so it is there for the first week and gone with the first flick after
  that.
- **Empty states explain instead of reporting.** "No pages yet" now says who
  creates the routes pages go under; "No galleries yet" says what a gallery is
  for.
- **The empty editor is a short glossary** of the destinations this project
  actually has, rather than "No item selected".
- **A project with a single media gallery opens it**, so Media shows media
  instead of one collapsed row named after a module file.
- **A site map of twenty pages or fewer arrives open.** With a home page at `/`
  the whole site nests under one root row, so Pages used to show a single row
  called Home. Larger sites keep the old behaviour.
- **Settings points at Account** for the per-person settings — the theme, and
  how the Studio behaves on this machine — which is where people look for them.

**A guided tour**, behind a glowing "Take a tour" button in the top bar: welcome,
then Pages, Media and Data if the project has them, then Review, Preview and
Publish. It never opens itself, and the glow stops for good once somebody has
been in it. Turn the offer off under **Account → Workspace** (on by default);
the tour itself stays in **Quick actions** either way.
