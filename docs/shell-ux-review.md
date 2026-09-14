# UX review: the new shell, for somebody using it for the first time

The feedback this answers, more or less verbatim: _it is hard to know what is
what and how to find stuff in the new shell. That Pages is a concept. What the
point is of Media. What is Data._

That is not a complaint about layout. Every one of those is the same question —
**what does this word mean here** — and the shell never answers it anywhere. This
is a review of why, what was changed about it, and what was deliberately left
alone.

Scope: `packages/ui/spa/components/shell`. Desktop and phone, first session, an
editor who did not build the site.

## The core finding

Val's three destinations are named with three words that are precise inside Val
and vague everywhere else:

| word      | what an editor assumes                        | what it is in Val                                                    |
| --------- | --------------------------------------------- | -------------------------------------------------------------------- |
| **Pages** | "the pages", vaguely                          | one row per URL your `s.router` resolves, nested as the site is      |
| **Media** | "where my images went"                        | the shared library a file is uploaded to once and used from anywhere |
| **Data**  | nothing at all — it is not a noun anyone uses | every val module that is not a router, a gallery or settings         |

Before this change, the Studio said each word in exactly three places — the rail
tooltip, the panel header and the empty state — and all three said **the same
one word again**. There was no surface anywhere in the product that defined any
of them. The rail is icons-only, so before the tooltip appears, `Braces` (`{}`)
is the only thing standing for Data — a developer's icon for the concept an
editor is least likely to guess.

Everything below follows from that.

## What was changed

Small, and all of it copy or default state except the tour.

1. **Rail tooltips carry a definition.** `RAIL_ITEMS` gained a `description`;
   the tooltip is the label with one clause under it ("The pages of your site,
   by URL"). The tooltip is the one place a definition costs nothing, because
   it is already showing and the reader has already read the label.
2. **Empty states explain rather than report.** "No pages yet" now says what a
   page is and who creates the routes; "No galleries yet" says what a gallery is
   for. An empty state is read by exactly the person who does not know yet.
3. **The empty editor lists the destinations with definitions.** It said "No
   item selected" and named all three without defining any — the complaint in
   miniature, on the first screen of the product. It is now a short glossary
   plus a way into the tour, and it names only the destinations this project
   actually has.
4. **A single media gallery opens itself.** Most projects have exactly one.
   Media opened as a single collapsed row named after a module file path, which
   is the strongest possible answer to "what is the point of Media?" — there was
   no media on screen. Galleries still start closed where there is more than
   one, for the reason that rule exists: thumbnails.
5. **A small site map opens itself.** With a home page at `/`, `toShellPages`
   nests the whole site under one root row, so "nothing is expanded" meant Pages
   showed one row called Home. Sites up to twenty pages now arrive open;
   anything larger keeps the old rule, where opening everything buries the top
   of the tree rather than revealing it.
6. **Settings points at Account.** The split is real — Settings is
   `s.settings()` content that gets published and is shared by the team, Account
   is one person on one machine — but it is invisible, and Settings is where
   anyone goes looking for dark mode. One line at the foot of the panel, linking
   across.
7. **A guided tour, behind a button that glows once.** Welcome, then Pages,
   Media and Data if the project has them, then Review, Preview and Publish in
   the order the top bar puts them. See below.

## The tour

- **It never opens itself.** The glow is the whole offer. A tour that pops up is
  the most annoying thing an editor can be handed on their second visit, and the
  feedback asked for help finding things, not for a dialog to dismiss.
- **The glow stops for good once someone has been in it** — finished or
  abandoned, since having said no once is a clear answer. Per browser
  (`val:tour:completed`), which is the honest scope of the guess it is making.
- **It can be turned off for the whole project**, under Settings → Studio
  (`studio.tour` in `s.settings()`, unset meaning yes). That is a decision a
  team makes once rather than each person dismissing it on each machine, which
  is what makes it content — published, reviewable, shared. The only thing kept
  per browser is whether a given person has already been through it, which is
  not a decision and has nothing to agree about.
- **It is offered in exactly two places**: the empty editor at `/val/~`, which
  is the first thing anybody sees, and Quick actions. Deliberately not the top
  bar — that row is Review, Preview and Publish, the controls for shipping a
  change, and a permanent onboarding button among them is clutter for everybody
  who has read it once. Not the Account panel either, which held one while the
  setting lived there. On the empty editor the button glows while the tour is
  new and stays, quietly, once it is not; switching `studio.tour` off takes it
  away entirely and leaves Quick actions, which is what makes switching it off
  safe rather than destructive.
- **Its words are in one file**, `packages/ui/spa/components/shell/tourCopy.ts`,
  which holds nothing else. Which steps a project gets and what each points at
  are in `tourSteps.ts`; rewriting the prose needs no other change.
- **The steps are conditional on the project.** Explaining Pages to a project
  with no router sends somebody looking for an icon that is not in the rail, and
  the same goes for the assistant, which is explained only where one is
  configured.
- **Titles never define a word with themselves.** "Pages are the pages of your
  site" was the first draft, and it tells the one person who needs that step
  precisely nothing. A destination's title is a noun with a gloss — "Pages —
  every URL on your site" — matching the shape of its tooltip in the rail;
  something you do gets a verb.
- **It drives the real navigation.** Each destination step opens the actual
  panel behind the card, because what has to be recognisable tomorrow is the
  panel, not a picture of one.
- **A missing target degrades to a centred card.** The rail is not drawn below
  1200px and three of the top bar's controls move to the bottom bar on a phone,
  so no step may say "this button here".

## Findings not acted on

Each of these is real, and each is bigger than "minor".

- **The rail is icons-only.** A tooltip is a hover: it does not exist on a
  touch screen, and it is not there when you are scanning. Labels under the
  icons — a 64–72px rail rather than 48 — would answer the naming complaint at
  the moment someone is actually looking, instead of one hover later. This is
  the single highest-value change left, and it is a layout change.
- **"Data" is the weakest name in the product.** It is defined negatively — what
  is left after routers, galleries and settings — which is why it is hard to
  describe. "Content" is taken, "Shared content" is closer to true. Renaming a
  destination is not a minor fix.
- **Data rows are file names.** `settings`, `nav`, `footer`, in the directory
  tree the modules are in. Honest, and developer-shaped: the schema could carry
  a display name.
- **Quick actions is an unlabelled `PanelRight` icon** holding Review on mobile,
  Discard all, New page, Upload media and now the tour. Nothing about that icon
  suggests any of it.
- **Nothing explains drafts.** The Draft chips, the Review count, and the fact
  that edits are invisible to the public until Publish, are the model an editor
  most needs and are currently learned by inference. The tour covers it once;
  the shell still does not.
- **The panels do not say what they are.** An earlier pass put one muted line
  under each of Pages, Media and Data ("One row per page of your site, nested
  the way its URLs are", and so on). It was taken out again: with the tour
  explaining the same three words properly, a permanent line in every panel is
  a sentence everybody past their first week reads forever. If the tour turns
  out not to be enough — people skip it, or arrive at a Studio somebody else set
  up — this is the cheapest thing to put back.
- **Two settings-shaped things sit together at the foot of the rail** (the cog
  and the avatar) and hold what one person would expect in one place. The
  pointer above is a patch on a naming problem, not a fix for it.
