# Proposals on a desktop, as ASCII

The Studio's proposals UI on a desktop (1440 × 900), one frame per Storybook
story, so a change can be sketched here and agreed on before anyone touches a
component. Each frame names the story it comes from: open
`iframe.html?id=<that id>` in Storybook (`pnpm --filter @valbuild/ui storybook`)
to see the real thing.

These frames show how things are **now**. To propose a change, copy a frame
and edit the copy, so the two can be read side by side.

## Legend

```text
[Label]       a button                    {Label}      primary, proposal purple
<Label>       primary, the site's green   [!! Label!]  red: an error or a destructive act
[-Label-]     disabled                    [@ Label]    with a spinner
(o The site v)  the switcher, on the site {Y Name v}   the switcher, in a proposal
(^)           the Updates icon            (!*)         Updates, with a security fix (red dot)
Review(9+)    Review, with its badge      [|]  (3)     the panel toggle, notifications
=====         the top bar's purple ring: you are in a proposal
-----         the top bar on the site
V P M {}      the left rail: logo, Pages, Media, Data;  * settings, FR the account
```

## What the frames show

Things that stand out from going through them. They are notes to discuss,
not decisions.

**Upgrade proposals**

- Publish appears twice: as `[Publish]` in the bar and as the notice's
  `{Publish to update quiet-harbor-24}`. They open the same dialog.
- While the upgrade is still being worked out, or after it failed, the notice
  says there is nothing to publish, but the bar's Publish is still enabled.
- The Publish dialog is the content dialog unchanged: "0 changes", "Its
  changes go to the site", and checks about pages. Nothing says what it
  upgrades.
- The `...` menu offers Rename (Val Build names upgrades after their kind) and
  says "Close…" for what its dialog calls "Discard".
- Content can be edited at an upgrade's address. Save appears, while the
  notice keeps saying "It holds no content changes".
- In the switcher and in All proposals, an upgrade uses the same branch icon as
  any proposal. Only the "Upgrade" subtitle sets it apart.
- On the site, "an upgrade is under way" is a purple notice, the colour that
  otherwise means "you are in a proposal".
- "Updates available" is an icon with no label on a desktop. What it says is
  only in its tooltip.

**All proposals**

- Every dialog's overlay is opaque (`bg-bg-primary`), so the whole Studio
  disappears behind New, Rename, Close, Publish and All proposals.
- The bar reads Switcher · Publish · `...` in the middle and Save on the far
  right. When code is staged, Build comes in before Save and moves everything
  else along.
- At a published proposal's address the bar stays purple and the fields can
  still be edited. Only the notice says it is finished.
- Making a proposal's address, "Updating the preview…" and the render check
  (`setup`, `overlay`, `renderCheck` on `StudioLocation`) are passed to the bar
  and shown nowhere.
- In these stories the status bar is the mock data's (`main`, "Building", "All
  changes saved"), whatever the proposal's state. Check what the app shows
  there before reading anything into it.

<!-- generated -->

## Proposals/Proposals

### On the site

`proposals-proposals--on-the-site` — Every project with proposals starts here.

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search ^K]                                (o The site v)             Review(9+) [Preview] <Publish>  [|] (3)  |
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
|V |  val-demo [Search ^K]                                (o The site v)             Review(9+) [Preview] <Publish>  [|] (3)  |
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
|V |  val-demo [Search ^K]                                (o The site v)             Review(9+) [Preview] <Publish>  [|] (3)  |
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

### In a proposal, nothing open

`proposals-proposals--in-a-proposal` — The bar wears the proposal colour (`===`). Publish sits by the switcher; Save is far right.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] {Save 3}  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### In a proposal, editing a page

`proposals-proposals--in-a-proposal-editing-a-page` — What an editor mostly looks at: only the bar says the edits go to a proposal.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] {Save 3}  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### All saved

`proposals-proposals--in-a-proposal-all-saved` — Save is disabled.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] [-Save-]  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### The proposal's menu (...)

`proposals-proposals--in-a-proposal-menu-open`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] {Save 3}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                       +--------------------------------+                                 |
|M |                                                       | <>  Compare with the site      |                                 |
|{}|                                                       |  /  Rename...                  |                                 |
|  |                          Pick something to edit       |  @  Copy link                  |                                 |
|  |                          Everything in this project is| --------------------------     |                                 |
|  |                          Pages   One row per page of y|  x  Close...          (red)    |                                 |
|  |                          Media   Images and files, upl+--------------------------------+                                 |
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

### Switcher open (in a proposal)

`proposals-proposals--in-a-proposal-switcher-open`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] {Save 3}  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Publish blocked

`proposals-proposals--in-a-proposal-publish-blocked` — Disabled, the reason only on hover: "It is being brought up to date with the site."

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                   {Y Spring campaign v} [-Publish-] [...]  Review(9+) [Preview] {Save 3}  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Saving

`proposals-proposals--saving`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] {@ Saving...}  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Save blocked by validation errors

`proposals-proposals--save-blocked-by-validation-errors` — Save becomes a red "Fix 2" that goes to the errors.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                  {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] [!! Fix 2!]  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Save failed

`proposals-proposals--save-failed` — The reason is on hover.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]            {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] [!! Save failed!]  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Build required (code staged)

`proposals-proposals--build-required` — A third action appears before Save. Publish shifts left.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]  {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] [# Build required] [-Save-]  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Building

`proposals-proposals--building`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]     {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] [@ Building...] [-Save-]  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Build failed

`proposals-proposals--build-failed` — Red, reason on hover, press to build again.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]  {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] [!! Build failed!] [-Save-]  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### New proposal

`proposals-proposals--new-proposal`

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is hidden: the dialog's overlay is opaque)                                                                |
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
|  |                               | [                                               ]        |                               |
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

### New proposal: one already exists

`proposals-proposals--new-proposal-already-exists`

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is hidden: the dialog's overlay is opaque)                                                                |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Y New proposal                                    x      |                               |
|  |                               | ...                                                      |                               |
|  |                               | Starts from                                              |                               |
|  |                               | [ The site as it is now                         ]        |                               |
|  |                               | There is already a proposal of the site as it is         |                               |
|  |                               | now: open Spring campaign.                               |                               |
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
|  |    (the Studio is hidden: the dialog's overlay is opaque)                                                                |
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
|  |    (the Studio is hidden: the dialog's overlay is opaque)                                                                |
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
|  |    (the Studio is hidden: the dialog's overlay is opaque)                                                                |
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
|  |                               | ----------------------------------------------------     |                               |
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
|  |    (the Studio is hidden: the dialog's overlay is opaque)                                                                |
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

`proposals-proposals--published-proposal` — Finished, but the bar is still purple and the fields are still editable.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                   {Y Spring campaign v} [-Publish-] [...]  Review(9+) [Preview] [-Save-]  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Published, changes moved to a new proposal

`proposals-proposals--published-proposal-continued`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                   {Y Spring campaign v} [-Publish-] [...]  Review(9+) [Preview] [-Save-]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | v "Spring campaign" is published                                                     |                               |
|  |   |   Changes made while it was published went to "Spring campaign (continued)".         |                               |
|  |   |   {Open Spring campaign (continued)}  [Go to the site]                               |                               |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

## Proposals/Upgrade in the Studio

### Updates available (on the site)

`proposals-upgrade-in-the-studio--updates-available` — Just an icon `(^)` in the bar, left of the panel toggle. The label is a tooltip.

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search ^K]                                (o The site v)          Review(9+) [Preview] <Publish> (^) [|] (3)  |
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

`proposals-upgrade-in-the-studio--security-updates-available` — The icon becomes a shield with a red dot.

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search ^K]                                (o The site v)         Review(9+) [Preview] <Publish> (!*) [|] (3)  |
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

`proposals-upgrade-in-the-studio--upgrade-under-way` — A purple notice on the site, although you are not in a proposal.

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search ^K]                                (o The site v)             Review(9+) [Preview] <Publish>  [|] (3)  |
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

`proposals-upgrade-in-the-studio--upgrade-in-the-switcher` — Same icon as any proposal; "Upgrade" stands where the changes count would be.

```text
 _____________________________________________________________________________________________________________________________
|  | ------------------------------------------------------------------------------------------------------------------------ |
|V |  val-demo [Search ^K]                                (o The site v)             Review(9+) [Preview] <Publish>  [|] (3)  |
|  | ------------------------------------------------------------------------------------------------------------------------ |
|P |                                       +------------------------------------------+                                       |
|M |   +-----------------------------------| (o) The site                      here   |-------+                               |
|{}|   | (^) Minor versions: an upgrade is |     What visitors see                    |]      |                               |
|  |   +-----------------------------------| ----------------------------------       |-------+                               |
|  |                                       | PROPOSALS                                |                                       |
|  |   [/] [DRAFT]                         |  Y  Minor versions                       |                                       |
|  |   /                                   |     You . Upgrade                        |                                       |
|  |   /app/page.val.ts?p="/"              |  Y  Spring campaign                      |                                       |
|  |   ------------------------------------|     You . 15 changes                     |------                                 |
|  |   Title  Shown in the browser tab and |  Y  New pricing page                     |                                       |
|  |                                       |     Kari Nordmann . 4 changes            |                                       |
|  |                                       | ----------------------------------       |                                       |
|  |                                       |  +  New proposal                         |                                       |
|  |                                       |  =  All proposals...                     |                                       |
|  |                                       +------------------------------------------+                                       |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### All proposals, with an upgrade

`proposals-upgrade-in-the-studio--upgrade-in-all-proposals`

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is hidden: the dialog's overlay is opaque)                                                                |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Y Proposals                     [+ New proposal]  x      |                               |
|  |                               |  Open 3 | Merged 1 | Closed 1                            |                               |
|  |                               | ----------------------------------------------------     |                               |
|  |                               | Y Minor versions  You                       [Open]       |                               |
|  |                               |   Upgrade . edited 15m ago                               |                               |
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

### In an upgrade (ready)

`proposals-upgrade-in-the-studio--in-an-upgrade` — Publish appears twice: in the bar, and as the notice's primary button.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Minor versions v} [Publish] [...]       Review [Preview] [-Save-]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (^) This proposal upgrades Val 0.149.4 -> 0.149.7                                    |                               |
|  |   |     It holds no content changes: what you see is quiet-harbor-24 with newer          |                               |
|  |   |     packages. Look around, then publish it to update quiet-harbor-24.                |                               |
|  |   |     > And 5 more packages                                                            |                               |
|  |   |     {Publish to update quiet-harbor-24}  [See the checks in Val Build ->]            |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### In an upgrade, nothing open

`proposals-upgrade-in-the-studio--in-an-upgrade-nothing-open`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Minor versions v} [Publish] [...]       Review [Preview] [-Save-]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (^) This proposal upgrades Val 0.149.4 -> 0.149.7                                    |                               |
|  |   |     It holds no content changes: what you see is quiet-harbor-24 with newer          |                               |
|  |   |     packages. Look around, then publish it to update quiet-harbor-24.                |                               |
|  |   |     > And 5 more packages                                                            |                               |
|  |   |     {Publish to update quiet-harbor-24}  [See the checks in Val Build ->]            |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |                          Pick something to edit                                                                          |
|  |                          Everything in this project is in the navigation:                                                |
|  |                          Pages   One row per page of your site, by URL.                                                  |
|  |                          Media   Images and files, uploaded once and used anywhere.                                      |
|  |                          Data    Content that is not tied to one page.                                                   |
|  |                          <Take a tour>                                                                                   |
|  |                                                                                                                          |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### In a security upgrade

`proposals-upgrade-in-the-studio--in-a-security-upgrade`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Security fixes v} [Publish] [...]       Review [Preview] [-Save-]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (#) This proposal fixes security issues                                              |                               |
|  |   |     It holds no content changes: what you see is quiet-harbor-24 with newer          |                               |
|  |   |     packages. Look around, then publish it to update quiet-harbor-24.                |                               |
|  |   |     > 1 package . fixes 2 security issues                                            |                               |
|  |   |     {Publish to update quiet-harbor-24}  [See the checks in Val Build ->]            |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### In a major upgrade

`proposals-upgrade-in-the-studio--in-a-major-upgrade`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                      {Y Full upgrade v} [Publish] [...]        Review [Preview] [-Save-]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (^) This proposal upgrades Val 0.149.4 -> 1.0.0                                      |                               |
|  |   |     It holds no content changes: what you see is quiet-harbor-24 with newer          |                               |
|  |   |     packages. Look around, then publish it to update quiet-harbor-24.                |                               |
|  |   |     v And 5 more packages                       (expanded here, folded by default)   |                               |
|  |   |       @valbuild/tanstack 0.149.4 -> 1.0.0 [MAJOR]                                    |                               |
|  |   |       @valbuild/core 0.149.4 -> 0.149.7  ...                                         |                               |
|  |   |     {Publish to update quiet-harbor-24}  [See the checks in Val Build ->]            |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Upgrade being worked out

`proposals-upgrade-in-the-studio--in-an-upgrade-being-worked-out` — The notice says nothing can be published yet, but the bar's Publish is still enabled.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Minor versions v} [Publish] [...]       Review [Preview] [-Save-]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (^) Val Build is working out this upgrade                                            |                               |
|  |   |     It holds no content changes. When it is worked out and checked, it can be        |                               |
|  |   |     published from here.                                                             |                               |
|  |   |     [Open in Val Build ->]                                                           |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Upgrade failed

`proposals-upgrade-in-the-studio--in-an-upgrade-that-failed` — Same: the bar still offers Publish.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Minor versions v} [Publish] [...]       Review [Preview] [-Save-]  [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Upgrade with content edits

`proposals-upgrade-in-the-studio--in-an-upgrade-with-edits` — Save appears, and the notice still says "It holds no content changes".

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Minor versions v} [Publish] [...]    Review(2) [Preview] {Save 2}  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                                                                                          |
|M |   +--------------------------------------------------------------------------------------+                               |
|{}|   | (^) This proposal upgrades Val 0.149.4 -> 0.149.7                                    |                               |
|  |   |     It holds no content changes: what you see is quiet-harbor-24 with newer          |                               |
|  |   |     packages. Look around, then publish it to update quiet-harbor-24.                |                               |
|  |   |     > And 5 more packages                                                            |                               |
|  |   |     {Publish to update quiet-harbor-24}  [See the checks in Val Build ->]            |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|  |   [ Build better websites                                                              ]                                 |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Switcher open (in an upgrade)

`proposals-upgrade-in-the-studio--in-an-upgrade-switcher-open`

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Minor versions v} [Publish] [...]       Review [Preview] [-Save-]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                       +------------------------------------------+                                       |
|M |   +-----------------------------------| (o) The site                             |-------+                               |
|{}|   | (^) This proposal upgrades Val 0.1|     What visitors see                    |       |                               |
|  |   |     It holds no content changes: w| ----------------------------------       |       |                               |
|  |   |     packages. Look around, then pu| PROPOSALS                                |       |                               |
|  |   |     > And 5 more packages         |  Y  Minor versions                here   |       |                               |
|  |   |     {Publish to update quiet-harbo|     You . Upgrade                        |       |                               |
|  |   +-----------------------------------|  Y  Spring campaign                      |-------+                               |
|  |                                       |     You . 15 changes                     |                                       |
|  |   [/] [DRAFT]                         |  Y  New pricing page                     |                                       |
|  |   /                                   |     Kari Nordmann . 4 changes            |                                       |
|  |   /app/page.val.ts?p="/"              | ----------------------------------       |                                       |
|  |   ------------------------------------|  +  New proposal                         |------                                 |
|  |   Title  Shown in the browser tab and |  =  All proposals...                     |                                       |
|  |                                       +------------------------------------------+                                       |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### The menu (in an upgrade)

`proposals-upgrade-in-the-studio--in-an-upgrade-menu-open` — Same menu as any proposal: Rename is offered, and it says Close where the dialog says Discard.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                     {Y Minor versions v} [Publish] [...]       Review [Preview] [-Save-]  [|] (3)  |
|  | ======================================================================================================================== |
|P |                                                       +--------------------------------+                                 |
|M |   +---------------------------------------------------| <>  Compare with the site      |-+                               |
|{}|   | (^) This proposal upgrades Val 0.149.4 -> 0.149.7 |  /  Rename...                  | |                               |
|  |   |     It holds no content changes: what you see is q|  @  Copy link                  | |                               |
|  |   |     packages. Look around, then publish it to upda| --------------------------     | |                               |
|  |   |     > And 5 more packages                         |  x  Close...          (red)    | |                               |
|  |   |     {Publish to update quiet-harbor-24}  [See the +--------------------------------+ |                               |
|  |   +--------------------------------------------------------------------------------------+                               |
|  |                                                                                                                          |
|  |   [/] [DRAFT]                                                                                                            |
|  |   /                                              <- the page's heading                                                   |
|  |   /app/page.val.ts?p="/"                                                                                                 |
|  |   --------------------------------------------------------------------------------------                                 |
|  |   Title  Shown in the browser tab and search results                                                                     |
|* | ------------------------------------------------------------------------------------------------------------------------ |
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```

### Publish an upgrade

`proposals-upgrade-in-the-studio--publish-an-upgrade` — The ordinary dialog: "0 changes", "Its changes go to the site", checks about pages.

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is hidden: the dialog's overlay is opaque)                                                                |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Publish "Minor versions" to the site              x      |                               |
|  |                               | Its changes go to the site as one change, checked        |                               |
|  |                               | before anything there changes. The proposal is           |                               |
|  |                               | finished afterwards.                                     |                               |
|  |                               |                                                          |                               |
|  |                               | 0 changes                                 [Compare]      |                               |
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

### Publishing an upgrade

`proposals-upgrade-in-the-studio--publishing-an-upgrade`

```text
 _____________________________________________________________________________________________________________________________
|  |                                                                                                                          |
|  |                                                                                                                          |
|  |    (the Studio is hidden: the dialog's overlay is opaque)                                                                |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Publish "Minor versions" to the site              x      |                               |
|  |                               | Its changes go to the site as one change, checked        |                               |
|  |                               | before anything there changes. The proposal is           |                               |
|  |                               | finished afterwards.                                     |                               |
|  |                               |                                                          |                               |
|  |                               | @ Building the site with it...                           |                               |
|  |                               | ----------------------------------------------------     |                               |
|  |                               |                            Cancel  [-@ Publishing...-]   |                               |
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
|  |    (the Studio is hidden: the dialog's overlay is opaque)                                                                |
|  |                                                                                                                          |
|  |                               +----------------------------------------------------------+                               |
|  |                               | Published "Minor versions"                        x      |                               |
|  |                               | It is live on the site, as one change. This              |                               |
|  |                               | proposal is finished: anything more starts a new         |                               |
|  |                               | one.                                                     |                               |
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
|  |    (the Studio is hidden: the dialog's overlay is opaque)                                                                |
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

### In an ordinary proposal while an upgrade is open

`proposals-upgrade-in-the-studio--in-a-proposal-while-an-upgrade-is-open` — Nothing about the upgrade. The Updates icon shows here too, next to Save.

```text
 _____________________________________________________________________________________________________________________________
|  | ======================================================================================================================== |
|V |  val-demo [Search ^K]                  {Y Spring campaign v} [Publish] [...]  Review(9+) [Preview] {Save 3} (^) [|] (3)  |
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
|FR|  Y main                          (o) Building ===---  ^  |  * All changes saved                                          |
'--'--------------------------------------------------------------------------------------------------------------------------'
```
