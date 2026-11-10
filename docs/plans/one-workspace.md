# One workspace: Content | Preview | Sketch | Assistant

The Studio's workspace as one layout, in every mode: the content editor,
code mode and the Sketchpad stop being separate workspaces and become panes
around one preview. This plan is what was decided while prototyping it; the
prototype is in `packages/ui/spa/components/shell/workspace/` and its stories
are **Shell/Workspace layout (prototype)**.

## What is already true (valbuild/val#1019)

Do not redo these; build on them.

- **One preview.** `CanvasFrame` is the preview of the content editor, of code
  mode and of the Sketchpad (`SketchpadPreview`). Code mode no longer has a
  workspace of its own: its view is the code changes (`CodeChanges`) in the
  editor's column, beside the canvas, with the canvas held open
  (`canvasPinned`) and the assistant docked beside it (`dockAssistant`).
- **It follows the code and the content.** Content edits are relayed to the
  page as they are made. A new build served (`ManifestSource.servedBuild`)
  makes every preview load the page again (`useBuildEpoch` ->
  `CanvasFrame`'s `documentKey`). `e2e/http/previewFollowsBuild.spec.ts`
  pins both.
- **Preview mode turns itself on.** `CanvasPreviewNotice`: a spinner for
  10 s, retries every 5 s for 30 s, then the message with the button.
- **The design tab is gone** from val. (Its server side in valbuild/home --
  `framedSignIn`, the "design tab first" server-build gate,
  `docs/design-tab.md` -- is not removed yet.)

## The layout

Four panes: **Content**, **Preview**, **Sketch**, **Assistant**.
`workspaceLayout()` decides where they go at any window width, and is the
rule to implement, not a sketch of one:

1. **The anchor** is the Preview while it is open; with it closed, the first
   open pane of Content, Sketch and Assistant (`anchorOf`). The preview keeps
   at least `PREVIEW_MIN` (560 px); another anchor `ANCHOR_MIN` (420 px).
2. **The widest arrangement that leaves the anchor its minimum**: every open
   pane its own column; then Sketch and Assistant as tabs in one column; then
   the anchor and ONE column, the one used last (`recent`).
3. **What does not fit is not closed.** It folds to a strip at its edge, one
   click from coming back. If even one column does not fit beside the
   anchor, the pane in use is a sheet over it.
4. **A phone** shows one pane at a time, switched from a bottom bar; the
   preview is always one of them.

Widths: rail 88, gutter 12, gap 8, strip 40, Content 340-480 (28 % of the
room), Sketch and Assistant 420 (`AI_PANEL_WIDTH`).

What it gives, by window: 2560 → four columns; 1920 and 1512 → Content |
Preview | Sketch ↔ Assistant; 1366 → Content | Preview with Sketch/Assistant
folded (or the reverse, by what was used last); 1024 → as 1366, the
assistant a sheet over the preview when in use; 390 → one pane.

## Decided

- **The top bar stays as it is.** Search, members, locale, Review,
  Save/Publish, errors, history, notifications and the account keep their
  places. The only change: **Content | Preview | Sketch | Assistant** switches
  take the Preview button's place, from tablet width up. The last open pane
  cannot be switched off.
- **The preview can be switched off.** For content that is on no page, or to
  write at full width. Content then takes the middle, its fields kept to a
  readable width (720 px).
- **Content's header**: tabs **Content | On this page** on the left (the
  structural editor, and the fields found on the page), its **Select** on
  the right, toward the preview. Close, where there is one, on the outer edge.
- **Two Selects, one per side of the preview**, each at its header's edge
  nearest the preview, both looking the same at rest:
  - **Content's** picks **fields**, in every mode, and opens the one picked.
    It stays on until turned off. Fields are outlined solid, in the accent.
  - **The Assistant's** picks what the next message is about: **fields**,
    or in code mode **any element**. Once, then off; the pick is a chip
    above the composer, removable. Outlined dashed on hover -- in the
    proposal's colour in code mode, with a small `</>` on the button.
  - No Select in the preview's toolbar, no strip under its address bar: the
    pressed Select says what is picking. Esc stops it. Both are hidden while
    the preview is switched off.
  - On a phone, pressing either goes to the preview to pick, and back.
- **Sketch and Assistant's header**, mirroring Content's:
  - As **tabs** (Sketch ↔ Assistant): the tabs on the right; on the left
    what the tab in front does -- **Build** for Sketch, **Select** for the
    Assistant.
  - **Sketch in a column of its own** (ultrawide, a phone): its icon and
    name on the left, **Build** on the right.
  - **The Assistant in a column of its own**: its Select on the left, its
    tab on the right. On ultrawide the Select is in the Assistant's column,
    not Sketch's. With the Assistant closed, no Select.
  - **Build** replaces the Sketchpad's "Ask the assistant" (#1015's Build:
    the `<sketchpad>` card and the request to build it).
- **The phone's bottom bar is the four panes** (Content, Preview, Sketch,
  Assistant), and nothing else, as in the prototype. Save/Publish moves to
  the top bar beside the account, and the bell into the account menu.
  Replaces today's `MobileBottomBar` (assistant, bell, Preview, one primary
  action).
- **When one column fits beside the preview** (about 1200-1500 px) the
  other folds to a **strip** at its edge. Content never floats over the
  preview (`narrow: "strips"`).
- **History takes the preview's place** while it is open: "now | at commit"
  in the middle, the preview back when History closes. Content keeps its
  column.
- **The code diff is in Review** ("Compare with the site"), with the
  content changes. Code mode's `</>` menu links there; Content's header has
  no Code tab.
- **The preview's minimum stays 560 px.**
- **On a tablet** the side pane in use is a **sheet over the preview** (the
  rule's step 4), not a docked column with the preview below 560 px.
- **Code mode is said subtly**: the `</>` pressed in the top bar, the
  preview's frame in the proposal's colour, the `</>` on the Assistant's
  Select, the dashed outline.

## Open (ask before building on a guess)

Nothing at the moment. Answered (and moved to Decided above): 1 (strips),
2 (History takes the preview's place), 3 (the phone's bar is the four
panes), 4 (a sheet on a tablet), 5 (560 px), 8 (the code diff is in
Review). 6 (quick preview) was answered by #1022: it is in code mode's
status, made by Val Build a second after the staged files stop changing.

## Later

- **Code checkpoints.** The design tab had a history menu of the
  proposal's code, to go back to an earlier state of it; it went with the
  design tab, and nothing has it now. To come back, in the `</>` menu: the
  points the code was at (each staging, or each Build), and going back to
  one as a new staging, so going back is itself something to go back from.

## How to build it

In order, each step shippable on its own:

1. **One preview component.** Extract the canvas pane (`PageWorkspace`'s
   `CanvasWindow`, `CanvasToolbar`, `CanvasRouteBar`, `CanvasPreviewNotice`
   and the frame) into a `SitePreview`, and use it in `PageWorkspace` and in
   `SketchpadPreview`, so the Sketchpad's preview has the same toolbar.
   **Done:** `shell/canvas/SitePreview.tsx` owns the device, zoom, fit,
   reload and preview-mode state; the caller renders the page and adds what
   is its own (the canvas's Exit Preview and Select, the Sketchpad's route).
   Storybook: **Shell/SitePreview**. Since step 5 the Sketchpad has no
   preview at all (`SketchpadPreview` is gone): it uses the Studio's, and
   so does Review's page comparison, on both sides.
2. **The two Selects.** Content's is today's field picking (`isPicking`),
   moved to Content's header. The Assistant's is `CanvasFrame`'s
   `elementPicking` (any element, `PickedElement`, which already carries
   `valPath`), handed to `useAI` as the message's `pointedAt` -- the
   plumbing (`SendContext`, `pickedElementPrompt`) is there. Then give the
   Studio's assistant the page tools the design tab had (`read_page`,
   `screenshot_page`; their runners are still in `proposals/proposalCode.ts`).
   **Done:** `SelectButton` is both. Content's is in the editor column's
   header (desktop) and on the phone's strip, and Esc stops it -- from the
   page too (`pickingStopped`). The Assistant's is in the chat panel's
   header while the preview is open: `elementPicking` on the frame, with
   `fieldsOnly` outside code mode and the proposal's colour in it (both new,
   optional fields of `pickElements`); the pick is a chip above the composer
   and goes with the next message (`AssistantPage`, `takePointedAt`). The
   Studio's assistant has `read_page` and `screenshot_page` while the preview
   is open (`hooks/pageTools.ts`), without `device`: the width is the
   person's switch. To make pointing work before step 3, the assistant is
   docked beside the preview on a desktop whenever the preview is open.
   Still to decide: on a phone, nothing says the Assistant's Select is
   picking while its sheet is out of the way; and Content's tabs are still
   called Structure | On page.
3. **The layout.** Replace `PageWorkspace`'s editor | canvas split, and
   `Shell`'s `workspaceOverride` (the Sketchpad) and docking rules, with
   `workspaceLayout()`: columns, tabs, strips, sheets. The editor column
   becomes the Content pane; the Sketchpad and the chat become panes.
   Keep the drag handle between columns (today's resizable split).
   **Done:** `Shell` lays the panes out with `workspaceLayout()` above a
   phone, and `placePanes()` (tested) says where each goes. Content and the
   preview stay in `PageWorkspace`, with the drag handle; Content's column
   takes the rule's width, folds to a strip (still mounted) or is a sheet.
   Sketch (`sketchPane`, the sketchpad without a preview of its own: the
   page it is about is shown in the one preview) and the Assistant (a pane
   of its own, `chatOpen`, no longer one of the panels) are columns, tabs,
   strips or a sheet; both stay mounted where they are and are placed, so a
   conversation and a sketch keep their state. History takes the preview's
   place; code mode's code changes are in Review, and its `</>` menu opens
   them there.
4. **The top bar's switches**, replacing the Preview button.
   **Done:** `PaneSwitches`, from a tablet up: Content | Preview | Sketch |
   Assistant, the last open pane cannot be switched off, and the Preview
   switch keeps the new-tab preview behind its chevron.
5. **Phone and tablet**, once the open questions are answered; then the
   tour's steps (`tourSteps.ts`), which point at controls that move.
   **Done:** on a phone `PhonePaneBar` is the bottom bar -- the four panes,
   one on screen at a time (`phonePane` in `Shell`), a pane not open yet
   opening when it is tapped -- in place of `MobileBottomBar`. Save/Publish
   (and its menu) are in the top bar beside the account; the notifications
   are an Activity row in the account sheet, with a dot on the avatar. The
   strip above Content is Content | On this page and Content's Select; the
   Preview pane's header has the address bar, the Select and the way out.
   The assistant is a pane (`mobileVariant="pane"`), under the sheets a
   phone opens. The Sketchpad is a pane too, and uses the Studio's preview:
   a route divider shows its page there (`useSketchRoute`), and opening a
   sketch no longer opens the assistant with it. A tablet's side pane is a
   sheet over the preview (step 3). The tour's targets are on the pane bar
   (`preview`, `ai`) and the phone's Publish. e2e: `mobile-canvas.spec.ts`.

Tests to keep honest: `workspaceLayout.test.ts` (the rule), the canvas and
code-mode e2e specs (`canvasSuite.ts`, `previewFollowsBuild.spec.ts`), and
the blocking smoke (`--project=tanstack`).
