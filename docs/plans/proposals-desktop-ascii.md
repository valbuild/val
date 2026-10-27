# Proposals on a desktop, as ASCII

The Studio's proposals UI on a desktop (1440 × 900), one frame per Storybook
story, so a change can be sketched here and agreed on before anyone touches a
component. Each frame names the story it comes from: open
`iframe.html?id=<that id>` in Storybook (`pnpm --filter @valbuild/ui storybook`)
to see the real thing.

These frames show how things are **now**, after the redesign below. To
propose a change, copy a frame and edit the copy, so the two can be read side
by side.

## Legend

```text
[Label]       a button                    {Label}      primary, proposal purple
<Label>       primary, the site's green   [!! Label!]  red: an error or a destructive act
[-Label-]     disabled                    [@ Label]    with a spinner
(o The site v)  the switcher, on the site {Y Name v}   the switcher, in a proposal
(^) / (!)     Updates / security fixes    ^            an upgrade proposal (Y: any other)
(@) Label     progress beside the switcher  /!\ Label  the same, failed
Review(9+)    Review, with its badge      [|]  (3)     the panel toggle, notifications
=====         the top bar's purple ring: you are in a proposal
-----         the top bar on the site
V P M {}      the left rail: logo, Pages, Media, Data;  * settings, FR the account
```

## What changed, and why

**Save becomes Publish.** There is no Publish beside the switcher any more.
Where Publish is on the site, a proposal has one split button, shaped like
Preview beside it. Its main half is the step that comes next: Save while
anything is unsaved, Build while code is staged, then Publish. The caret lists
every step, Publish always among them, so publishing never waits for the
button to get there: Publish saves first. The phone's bottom bar already
worked this way, and both now follow the same rule (`nextProposalAction`).

The issues the first pass found, and what became of each:

- **Upgrade, two Publish buttons.** The notice's is gone; the bar's is the
  one. The notice says "press Publish" and links the checks.
- **Upgrade, Publish on while it could not work.** Off while the upgrade is
  being worked out, has failed, or found nothing, with the reason in the
  caret's menu.
- **Upgrade, a content Publish dialog.** It names the site it updates and what
  moves ("Val 0.149.4 → 0.149.7 and 5 more packages"), and says "No content
  changes" rather than "0 changes".
- **Upgrade, Rename and "Close…".** An upgrade's menu has no Rename, and says
  "Discard upgrade…", as its dialog does. Same on a phone.
- **Upgrade, "no content changes" after edits.** The notice counts them:
  "It also holds 2 content changes, made here, which are published with it."
- **Upgrade, same icon as a proposal.** An upgrade has the upgrade arrow in
  the switcher, All proposals and the phone sheet.
- **Upgrade under way, in proposal purple.** Neutral grey: it is the site.
- **Updates, an unlabelled icon.** Labelled on a desktop ("Val 0.150.0 is
  out"), an icon below that.
- **Dialogs hid the Studio.** The overlay is translucent now, every dialog in
  the Studio included.
- **A published proposal looked editable.** The button reads "Published" and
  does nothing. The fields can still be typed in: there is no read-only mode
  for fields to switch on, so that is left for later.
- **Setup, preview and render check shown nowhere.** Said beside the switcher
  while running ("Updating the preview…"), in warning yellow when one fails,
  why on hover, and nothing once done.
- **Status bar.** In the stories it named `main`; the app names the
  proposal's branch, and the stories do too now. And the app itself said "All
  changes saved" beside "Save 3": in a proposal it now counts what is not saved
  ("3 not saved to the proposal").

<!-- generated -->

## Proposals/Proposals

### On the site

`proposals-proposals--on-the-site` — Unchanged.

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search]                                   (o The site v)             Review(9+) [Preview] <Publish>  [|] (3)  |
|  | ------------------------------------------------------------------------------------------------------------------------ |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Switcher open (on the site)

`proposals-proposals--switcher-open`

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search]                                   (o The site v)             Review(9+) [Preview] <Publish>  [|] (3)  |
|  | ------------------------------------------------------------------------------------------------------------------------ |
|P |                                       +----------------------------------------+                                         |
|M |                                       | (o) The site                      here |                                         |
|{}|                                       |     What visitors see                  |                                         |
|  |                          Pick somethin| ----------------------------------     |                                         |
|  |                          Everything in| PROPOSALS                              |                                         |
|  |                          Pages   One r|  Y  Spring campaign                    |                                         |
|  |                          Media   Image|     You . 15 changes                   |re.                                      |
|  |                          Data    Conte|  Y  New pricing page                   |                                         |
|  |                          <Take a tour>|     Kari Nordmann . 4 changes          |                                         |
|  |                                       | ----------------------------------     |                                         |
|  |                                       |  +  New proposal                       |                                         |
|  |                                       |  =  All proposals...                   |                                         |
|  |                                       +----------------------------------------+                                         |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Switcher, no proposals yet

`proposals-proposals--switcher-with-no-proposals`

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search]                                   (o The site v)             Review(9+) [Preview] <Publish>  [|] (3)  |
|  | ------------------------------------------------------------------------------------------------------------------------ |
|P |                                       +------------------------------------------+                                       |
|M |                                       | (o) The site                      here   |                                       |
|{}|                                       |     What visitors see                    |                                       |
|  |                          Pick somethin| ----------------------------------       |                                       |
|  |                          Everything in| PROPOSALS                                |                                       |
|  |                          Pages   One r| None open. A proposal is a copy of the   |                                       |
|  |                          Media   Image| site you can change, save and share      |.                                      |
|  |                          Data    Conte| before it goes live.                     |                                       |
|  |                          <Take a tour>| ----------------------------------       |                                       |
|  |                                       |  +  New proposal                         |                                       |
|  |                                       |  =  All proposals...                     |                                       |
|  |                                       +------------------------------------------+                                       |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### In a proposal, unsaved changes

`proposals-proposals--in-a-proposal` — No Publish beside the switcher any more. `{Save 3|v}` is one split button where Publish is on the site; the status bar names the proposal's branch and counts what is not saved.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {Y Spring campaign v} [...]     Review(9+) [Preview] {Save 3|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  o 3 not saved to the proposal                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### The caret beside Save

`proposals-proposals--in-a-proposal-action-menu-open` — Publish is always one press away: it saves first.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {Y Spring campaign v} [...]     Review(9+) [Preview] {Save 3|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                       +----------------------------------------------+   |
|M |                                                                       | [s] Save 3 changes                           |   |
|{}|                                                                       |      Keep them in the proposal. Nothing      |   |
|  |                          Pick something to edit                       |      reaches the site.                       |   |
|  |                          Everything in this project is in the navigati| [^] Publish to the site                      |   |
|  |                          Pages   One row per page of your site, by URL|      Saves the changes first, then           |   |
|  |                          Media   Images and files, uploaded once and u|      publishes the proposal                  |   |
|  |                          Data    Content that is not tied to one page.+----------------------------------------------+   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  o 3 not saved to the proposal                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Everything saved: Save has become Publish

`proposals-proposals--in-a-proposal-all-saved`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {Y Spring campaign v} [...]  Review(9+) [Preview] {^ Publish|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Ready to publish, caret open

`proposals-proposals--in-a-proposal-all-saved-menu-open`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {Y Spring campaign v} [...]  Review(9+) [Preview] {^ Publish|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                       +----------------------------------------------+   |
|M |                                                                       | [^] Publish to the site                      |   |
|{}|                                                                       |      Merges the proposal into the site,      |   |
|  |                          Pick something to edit                       |      as one change                           |   |
|  |                          Everything in this project is in the navigati+----------------------------------------------+   |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### In a proposal, editing a page

`proposals-proposals--in-a-proposal-editing-a-page`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {Y Spring campaign v} [...]     Review(9+) [Preview] {Save 3|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   [/] [DRAFT]                                                                                                            |
|{}|   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|  |   Meta description                                                                                                       |
|  |   [ Val is a Git-based CMS for developers. Content lives in your repository as Type...  ]                                |
|  |   Hero image                                                                                                             |
|  |   [  img  ]  /public/val/hero_a1b2c.png  2400 x 1260                                                                     |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  o 3 not saved to the proposal                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### The proposal's menu (...)

`proposals-proposals--in-a-proposal-menu-open` — Unchanged for a content proposal.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {Y Spring campaign v} [...]     Review(9+) [Preview] {Save 3|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                         +--------------------------------+                               |
|M |                                                         | <>  Compare with the site      |                               |
|{}|                                                         |  /  Rename...                  |                               |
|  |                          Pick something to edit         |  @  Copy link                  |                               |
|  |                          Everything in this project is i| --------------------------     |                               |
|  |                          Pages   One row per page of you|  x  Close...          (red)    |                               |
|  |                          Media   Images and files, uploa+--------------------------------+                               |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  o 3 not saved to the proposal                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Switcher open (in a proposal)

`proposals-proposals--in-a-proposal-switcher-open`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {Y Spring campaign v} [...]     Review(9+) [Preview] {Save 3|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                       +----------------------------------------+                                         |
|M |                                       | (o) The site                           |                                         |
|{}|                                       |     What visitors see                  |                                         |
|  |                          Pick somethin| ----------------------------------     |                                         |
|  |                          Everything in| PROPOSALS                              |                                         |
|  |                          Pages   One r|  Y  Spring campaign               here |                                         |
|  |                          Media   Image|     You . 15 changes                   |re.                                      |
|  |                          Data    Conte|  Y  New pricing page                   |                                         |
|  |                          <Take a tour>|     Kari Nordmann . 4 changes          |                                         |
|  |                                       | ----------------------------------     |                                         |
|  |                                       |  +  New proposal                       |                                         |
|  |                                       |  =  All proposals...                   |                                         |
|  |                                       +----------------------------------------+                                         |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  o 3 not saved to the proposal                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Publish refused

`proposals-proposals--in-a-proposal-publish-blocked` — The reason is in the menu now, not only in a tooltip.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                           {Y Spring campaign v} [...]  Review(9+) [Preview] [-^ Publish-|v]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                       +----------------------------------------------+   |
|M |                                                                       | [^] Publish to the site          (off)       |   |
|{}|                                                                       |      It is being brought up to date with     |   |
|  |                          Pick something to edit                       |      the site.                               |   |
|  |                          Everything in this project is in the navigati+----------------------------------------------+   |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Saving

`proposals-proposals--saving`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                         {Y Spring campaign v} [...]  Review(9+) [Preview] [-@ Saving...-|v]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  o 3 not saved to the proposal                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Save blocked by validation errors

`proposals-proposals--save-blocked-by-validation-errors` — The main half is a red Fix 2; the caret's Publish is off, since it would save what cannot be saved.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {Y Spring campaign v} [...]  Review(9+) [Preview] [!! Fix 2|v!]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  o 3 not saved to the proposal                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Save failed

`proposals-proposals--save-failed`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                       {Y Spring campaign v} [...]  Review(9+) [Preview] [!! Save failed|v!]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  o 3 not saved to the proposal                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### A new proposal, while its address is made

`proposals-proposals--setting-up` — Beside the switcher, while it runs; nothing once it is done.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]           {Y Spring campaign v} [...] (@) Setting up...  Review(9+) [Preview] {^ Publish|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### After a save: updating the preview

`proposals-proposals--updating-the-preview`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]  {Y Spring campaign v} [...] (@) Updating the preview... Review(9+) [Preview] {^ Publish|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### After a save: checking it renders

`proposals-proposals--checking-the-preview`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]  {Y Spring campaign v} [...] (@) Checking the preview... Review(9+) [Preview] {^ Publish|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### The preview did not render

`proposals-proposals--preview-did-not-render` — In warning yellow; why is on hover ("/products answered 500").

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]  {Y Spring campaign v} [...] /!\ Preview did not render  Review(9+) [Preview] {^ Publish|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Build is next

`proposals-proposals--build-required` — Build is the main half once everything is saved. It used to be a third button.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                      {Y Spring campaign v} [...]  Review(9+) [Preview] [# Build required|v]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Build is next, caret open

`proposals-proposals--build-required-menu-open`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                      {Y Spring campaign v} [...]  Review(9+) [Preview] [# Build required|v]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                       +----------------------------------------------+   |
|M |                                                                       | [#] Build                                    |   |
|{}|                                                                       |      Code changed in this proposal. Build it |   |
|  |                          Pick something to edit                       |      so the preview shows it.                |   |
|  |                          Everything in this project is in the navigati| [^] Publish to the site                      |   |
|  |                          Pages   One row per page of your site, by URL|      Merges the proposal into the site,      |   |
|  |                          Media   Images and files, uploaded once and u|      as one change                           |   |
|  |                          Data    Content that is not tied to one page.+----------------------------------------------+   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Building

`proposals-proposals--building`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                       {Y Spring campaign v} [...]  Review(9+) [Preview] [-@ Building...-|v]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Build failed

`proposals-proposals--build-failed` — Red; the caret offers Build again, with why.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                      {Y Spring campaign v} [...]  Review(9+) [Preview] [!! Build failed|v!]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |                                                                                                                          |
|{}|                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### New proposal

`proposals-proposals--new-proposal`

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is dimmed and blurred behind it, but still there)                                                         |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Y New proposal                                    x      |                               |
|  |                               | A copy of the site you can change and save, with         |                               |
|  |                               | its own address. Nothing reaches the site until          |                               |
|  |                               | it is merged.                                            |                               |
|  |                               |                                                          |                               |
|  |                               | Name                                                     |                               |
|  |                               | [ Bright harbour                                ]        |                               |
|  |                               | Description (optional)                                   |                               |
|  |                               | [ What it changes, and why                      ]        |                               |
|  |                               | Starts from                                              |                               |
|  |                               | [ The site as it is now                         ]        |                               |
|  |                               | ----------------------------------------------------     |                               |
|  |                               |                          Cancel  {Create and open ->}    |                               |
|  |                               +----------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Rename

`proposals-proposals--rename-a-proposal`

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is dimmed and blurred behind it, but still there)                                                         |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Rename proposal                                   x      |                               |
|  |                               | Its address and its link stay the same.                  |                               |
|  |                               | Name                                                     |                               |
|  |                               | [ Spring campaign                               ]        |                               |
|  |                               | ----------------------------------------------------     |                               |
|  |                               |                                    Cancel  {Rename}      |                               |
|  |                               +----------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Close

`proposals-proposals--close-a-proposal`

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is dimmed and blurred behind it, but still there)                                                         |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Close "Spring campaign"?                          x      |                               |
|  |                               | Its 15 changes will not be published. You can            |                               |
|  |                               | reopen it from All proposals > Closed.                   |                               |
|  |                               | ----------------------------------------------------     |                               |
|  |                               |                       [Cancel]  [!! Close proposal!]     |                               |
|  |                               +----------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### All proposals

`proposals-proposals--all-proposals`

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is dimmed and blurred behind it, but still there)                                                         |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Y Proposals                     [+ New proposal]  x      |                               |
|  |                               |  Open 2 | Merged 1 | Closed 1                            |                               |
|  |                               | ----------------------------------------------------     |                               |
|  |                               | Y Spring campaign  You                      [Open]       |                               |
|  |                               |   Rewrite of all product copy for the spring launch      |                               |
|  |                               |   15 changes . edited 2h ago                             |                               |
|  |                               | ----------------------------------------------------     |                               |
|  |                               | Y New pricing page  Kari Nordmann           [Open]       |                               |
|  |                               |   4 changes . edited yesterday                           |                               |
|  |                               +----------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Publish, pressed

`proposals-proposals--publish-from-a-proposal`

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is dimmed and blurred behind it, but still there)                                                         |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Publish "Spring campaign" to the site             x      |                               |
|  |                               | Its changes go to the site as one change, checked        |                               |
|  |                               | before anything there changes. The proposal is           |                               |
|  |                               | finished afterwards.                                     |                               |
|  |                               |                                                          |                               |
|  |                               | 18 changes . 3 not saved yet, saved first [Compare]      |                               |
|  |                               | v Nobody has published to these pages since this         |                               |
|  |                               |   proposal started                                       |                               |
|  |                               | v Nobody has unpublished changes on these pages          |                               |
|  |                               | ----------------------------------------------------     |                               |
|  |                               |                                  Cancel  {^ Publish}     |                               |
|  |                               +----------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### At a published proposal's address

`proposals-proposals--published-proposal` — The button says Published and does nothing; there is no caret.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {Y Spring campaign v} [...]  Review(9+) [Preview] [v Published]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | v "Spring campaign" is published                                                     |                               |
|  |   |   It is live on the site, and finished: nothing more is kept here. To change         |                               |
|  |   |   more, start a new proposal.                                                        |                               |
|  |   |   {+ New proposal}  [Go to the site]                                                 |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/a1b2c3d4e5f6a7b8c9d0          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

## Proposals/Upgrade in the Studio

### Updates available (on the site)

`proposals-upgrade-in-the-studio--updates-available` — Labelled now, on a desktop. An icon alone below it.

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search]                     (o The site v)  Review(9+) [Preview] <Publish> | (^) Val 0.150.0 is out  [|] (3)  |
|  | ------------------------------------------------------------------------------------------------------------------------ |
|P |                                                                                                                          |
|M |   [/] [DRAFT]                                                                                                            |
|{}|   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|  |   Meta description                                                                                                       |
|  |   [ Val is a Git-based CMS for developers. Content lives in your repository as Type...  ]                                |
|  |   Hero image                                                                                                             |
|  |   [  img  ]  /public/val/hero_a1b2c.png  2400 x 1260                                                                     |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Security updates available

`proposals-upgrade-in-the-studio--security-updates-available` — Shield, in red, with its label.

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search]                 (o The site v)  Review(9+) [Preview] <Publish> | (!) Security fixes are out  [|] (3)  |
|  | ------------------------------------------------------------------------------------------------------------------------ |
|P |                                                                                                                          |
|M |   [/] [DRAFT]                                                                                                            |
|{}|   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|  |   Meta description                                                                                                       |
|  |   [ Val is a Git-based CMS for developers. Content lives in your repository as Type...  ]                                |
|  |   Hero image                                                                                                             |
|  |   [  img  ]  /public/val/hero_a1b2c.png  2400 x 1260                                                                     |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Upgrade under way (on the site)

`proposals-upgrade-in-the-studio--upgrade-under-way` — Neutral grey now: purple is for "you are in a proposal".

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search]                                   (o The site v)             Review(9+) [Preview] <Publish>  [|] (3)  |
|  | ------------------------------------------------------------------------------------------------------------------------ |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (^) Minor versions: an upgrade is under way in Val Build.     [Open upgrade ->]      |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|  |   Meta description                                                                                                       |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### The upgrade in the switcher

`proposals-upgrade-in-the-studio--upgrade-in-the-switcher` — Its own icon `^`, not the branch.

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search]                                   (o The site v)             Review(9+) [Preview] <Publish>  [|] (3)  |
|  | ------------------------------------------------------------------------------------------------------------------------ |
|P |                                       +----------------------------------------+                                         |
|M |   [/] [DRAFT]                         | (o) The site                      here |                                         |
|{}|   /                                   |     What visitors see                  |                                         |
|  |   /app/page.val.ts?p="/"              | ----------------------------------     |                                         |
|  |   ------------------------------------| PROPOSALS                              |--------                                 |
|  |   Title  Shown in the browser tab and |  ^  Minor versions                     |                                         |
|  |                                       |     You . Upgrade                      |                                         |
|  |                                       |  Y  Spring campaign                    |                                         |
|  |                                       |     You . 15 changes                   |                                         |
|  |                                       |  Y  New pricing page                   |                                         |
|  |                                       |     Kari Nordmann . 4 changes          |                                         |
|  |                                       | ----------------------------------     |                                         |
|  |                                       |  +  New proposal                       |                                         |
|  |                                       |  =  All proposals...                   |                                         |
|  |                                       +----------------------------------------+                                         |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### In an upgrade (ready)

`proposals-upgrade-in-the-studio--in-an-upgrade` — One Publish: the bar's. The notice links the checks.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {^ Minor versions v} [...]       Review [Preview] {^ Publish|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (^) This proposal upgrades Val 0.149.4 -> 0.149.7                                    |                               |
|  |   |     It holds no content changes: what you see is quiet-harbor-24 with newer          |                               |
|  |   |     packages. Look around, then press Publish to update quiet-harbor-24.             |                               |
|  |   |     > And 5 more packages                                                            |                               |
|  |   |     [See the checks in Val Build ->]                                                 |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/e5f6a7b8c9d0e1f2a3b4          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Upgrade being worked out

`proposals-upgrade-in-the-studio--in-an-upgrade-being-worked-out` — Publish is off, with the reason in its menu.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {^ Minor versions v} [...]     Review [Preview] [-^ Publish-|v]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (^) Val Build is working out this upgrade                                            |                               |
|  |   |     When it is worked out and checked, it can be published.                          |                               |
|  |   |     [Open in Val Build ->]                                                           |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/e5f6a7b8c9d0e1f2a3b4          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Upgrade failed

`proposals-upgrade-in-the-studio--in-an-upgrade-that-failed` — Publish is off.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {^ Minor versions v} [...]     Review [Preview] [-^ Publish-|v]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (^) This upgrade could not be worked out                                             |                               |
|  |   |     No version of @tanstack/react-start fits @valbuild/tanstack 0.149.7.             |                               |
|  |   |     [Open in Val Build ->]                                                           |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/e5f6a7b8c9d0e1f2a3b4          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Nothing to upgrade

`proposals-upgrade-in-the-studio--nothing-to-upgrade`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {^ Minor versions v} [...]     Review [Preview] [-^ Publish-|v]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (^) There is nothing to upgrade                                                      |                               |
|  |   |     quiet-harbor-24 is up to date. Discard this proposal from its menu.              |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|  |                                                                                                                          |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/e5f6a7b8c9d0e1f2a3b4          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Upgrade with content edits

`proposals-upgrade-in-the-studio--in-an-upgrade-with-edits` — Save is the main half again, and the notice says it holds them.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {^ Minor versions v} [...]       Review(2) [Preview] {Save 2|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (^) This proposal upgrades Val 0.149.4 -> 0.149.7                                    |                               |
|  |   |     It also holds 2 content changes, made here, which are published with it.         |                               |
|  |   |     Look around, then press Publish to update quiet-harbor-24.                       |                               |
|  |   |     > And 5 more packages                                                            |                               |
|  |   |     [See the checks in Val Build ->]                                                 |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/e5f6a7b8c9d0e1f2a3b4          (o) Building ===---  ^  |  o 2 not saved to the proposal                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### The menu (in an upgrade)

`proposals-upgrade-in-the-studio--in-an-upgrade-menu-open` — No Rename; Close is Discard upgrade, matching its dialog.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {^ Minor versions v} [...]       Review [Preview] {^ Publish|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                         +--------------------------------+                               |
|M |   +-----------------------------------------------------| <>  Compare with the site      |                               |
|{}|   | (^) This proposal upgrades Val 0.149.4 -> 0.149.7   |  @  Copy link                  |                               |
|  |   |     It holds no content changes: what you see is qui| --------------------------     |                               |
|  |   |     packages. Look around, then press Publish to upd|  x  Discard upgrade...  (red)  |                               |
|  |   |     > And 5 more packages                           +--------------------------------+                               |
|  |   |     [See the checks in Val Build ->]                                                 |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/e5f6a7b8c9d0e1f2a3b4          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Switcher open (in an upgrade)

`proposals-upgrade-in-the-studio--in-an-upgrade-switcher-open`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search]                             {^ Minor versions v} [...]       Review [Preview] {^ Publish|v}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                       +----------------------------------------+                                         |
|M |   +-----------------------------------| (o) The site                           |---------+                               |
|{}|   | (^) This proposal upgrades Val 0.1|     What visitors see                  |         |                               |
|  |   |     It holds no content changes: w| ----------------------------------     |         |                               |
|  |   |     packages. Look around, then pr| PROPOSALS                              |         |                               |
|  |   |     > And 5 more packages         |  ^  Minor versions                here |         |                               |
|  |   |     [See the checks in Val Build -|     You . Upgrade                      |         |                               |
|  |   +-----------------------------------|  Y  Spring campaign                    |---------+                               |
|  |                                       |     You . 15 changes                   |                                         |
|  |   [/] [DRAFT]                         |  Y  New pricing page                   |                                         |
|  |   /                                   |     Kari Nordmann . 4 changes          |                                         |
|  |   /app/page.val.ts?p="/"              | ----------------------------------     |                                         |
|  |   ------------------------------------|  +  New proposal                       |--------                                 |
|  |   Title  Shown in the browser tab and |  =  All proposals...                   |                                         |
|  |                                       +----------------------------------------+                                         |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y val/p/e5f6a7b8c9d0e1f2a3b4          (o) Building ===---  ^  |  * All changes saved                                    |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Publish an upgrade

`proposals-upgrade-in-the-studio--publish-an-upgrade` — Says what it updates; "No content changes" instead of "0 changes".

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is dimmed and blurred behind it, but still there)                                                         |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Publish "Minor versions" to update quiet-harbor-24 x     |                               |
|  |                               | It updates quiet-harbor-24's packages: Val               |                               |
|  |                               | 0.149.4 -> 0.149.7 and 5 more packages. The site         |                               |
|  |                               | is built and checked with them before anything           |                               |
|  |                               | there changes. The proposal is finished afterwards.      |                               |
|  |                               |                                                          |                               |
|  |                               | No content changes                        [Compare]      |                               |
|  |                               | v Nobody has published to these pages since this         |                               |
|  |                               |   proposal started                                       |                               |
|  |                               | v Nobody has unpublished changes on these pages          |                               |
|  |                               | ----------------------------------------------------     |                               |
|  |                               |                                  Cancel  {^ Publish}     |                               |
|  |                               +----------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Upgrade published

`proposals-upgrade-in-the-studio--upgrade-published`

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is dimmed and blurred behind it, but still there)                                                         |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Published "Minor versions"                        x      |                               |
|  |                               | It is live: quiet-harbor-24 runs the new packages.       |                               |
|  |                               | This proposal is finished.                               |                               |
|  |                               |                                                          |                               |
|  |                               | v Merged into the site.                                  |                               |
|  |                               | ----------------------------------------------------     |                               |
|  |                               |                            [Close]  {Go to the site}     |                               |
|  |                               +----------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Discard an upgrade

`proposals-upgrade-in-the-studio--discard-an-upgrade`

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is dimmed and blurred behind it, but still there)                                                         |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Discard "Minor versions"?                         x      |                               |
|  |                               | The site keeps the dependencies it has. You can          |                               |
|  |                               | reopen it from All proposals > Closed.                   |                               |
|  |                               | ----------------------------------------------------     |                               |
|  |                               |                       [Cancel]  [!! Discard upgrade!]    |                               |
|  |                               +----------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |                                                                                                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```
