# Editing on the page

Content's Select has two modes, chosen from the menu beside it and remembered
per browser (`selectModePreference.ts`):

- **Select** opens a picked field in the Studio's column. What a click on the
  page has always done, and the mode it starts in.
- **Select & edit** puts the caret in a picked TEXT where the page shows it.
  Everything that is not a text still opens in the column.

This page is about the second.

The parts, and nothing else knows about it:

| part                                                            | where                                                        | what it does                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `inlineEditing.ts`                                              | `@valbuild/shared`, run by `ValCanvasBridge` of each binding | Makes an element typable, and reads what was typed back as the field's value |
| `editInline`, `inlineEdit`, `inlineEditSelection`, and the rest | `valCanvasProtocol.ts`                                       | The conversation across the frame                                            |
| `useCanvasInlineEdit`, `inlineEditCandidates`                   | `@valbuild/ui`, `components/shell/canvas/`                   | Decides what to offer the page, and writes what comes back                   |
| `CanvasInlineRichTextToolbar`, `placeInlineToolbar`             | `@valbuild/ui`, `components/shell/canvas/`                   | The formatting controls floated over a richtext, and where they go           |
| `CanvasInlineEditFloat`                                         | `@valbuild/ui`, `components/shell/canvas/`                   | The field's validation errors, floated by any text, with those controls      |

## One round trip, and a way back

1. The page says an element was picked (`clicked`, with every path on it).
2. The Studio looks each path up (`inlineEditCandidates`) and offers the page
   the ones that are a **string** or a **richtext**, each with what it holds
   now (`editInline`).
3. The page edits the first of them an element SHOWS -- that element and nothing
   else (`canEditInline`) -- and says `inlineEditStarted`. When none is, it
   says `inlineEditUnavailable` and the Studio does what a pick does.

Step 3 is why the value travels: only the page can tell that `<h1>` holds the
title and nothing but the title, and it tells by comparing. A string inside a
sentence (`<p>Hi {name}!</p>`), in an attribute (`alt`, `href`), or transformed
on the way to the page is not typable where it is, and is opened in the column.
A richtext is typable when the element's children are the document's nodes, tag
for tag, which is what `ValRichText` renders unless a `transform` changes the
structure.

### Usually without the round trip

The round trip takes long enough (a few hundred milliseconds in development)
for the start of what is typed straight after a click to be lost: the keys
land on the page's body, which drops them, and an `End` pressed first is
lost too, so what follows goes in at the click. A phone also opens its
keyboard only for a focus given in the tap itself, which a message a moment
later is not.

So the Studio tells the page AHEAD of a click what its texts hold
(`textFields`, from `canvasTextFields.ts`): every path the page reported that
`editInline` would offer, with its value, whenever those change and while
Select & edit is on. A click on an element showing one of them and nothing
else starts the edit in the click, by the same `canEditInline` comparison,
and the page says `inlineEditStarted` with no `requestId`. The Studio checks
it again (`onStarted`) and has the page stop if it will not have it -- Select
& edit was turned off on the way. Which element shows a field is still the
page's to tell, and what counts as a text still the Studio's: nothing is
decided on one side alone.

When the element no longer shows what the Studio last said -- its value
changed a moment ago and the new one is still on its way -- the page asks as
before, and holds the keys pressed until the answer (`inlineEditKeys.ts`):
replayed into the text when the edit starts, through the same `keydown` and
`beforeinput` a real key goes through so Enter and Backspace in a richtext
still split and join; dropped when the field opens in the column instead, as
keys on a page that is not being typed in are. A Studio that predates
`textFields` never sends it, and every click asks.

So the mode never takes a way of editing away. That is also what makes a
version skew harmless: `editInline` is a capability a bridge lists in `ready`,
and a page whose `@valbuild/next` or `@valbuild/tanstack` predates it is never
asked.

## The column follows the caret, and the editor stays where it is

While a text is typed in on the page, the "On this page" column turns to the
page's fields, scrolls to that field's row and shows it as the selected one
(`editingCanvasPath` on `PageWorkspace`, `useFieldShownInColumn`). The row
shows what is typed as it is written, since it reads the same source.

It is NOT done by opening the field, which is what an ordinary pick does.
Opening moves the editor, and the editor moving can move the preview: a field
of a module that is not a page takes the canvas off the route it was on, and
the document the caret is in goes with it. So the column is told which row to
show, and nothing navigates. For the same reason it never changes pane on a
phone: the person is typing on the page, and the column is the other pane.

The row stays the selected one after the edit ends, until the editor itself
moves. A row going dark and another lighting up the moment Enter is pressed
reads as the edit having landed somewhere else.

## The page's element is never edited: a copy of it is

The element on the page is React's. Every edit comes back as a re-render of it
a moment later, once the Studio has made a patch of it and relayed the new
source (`sourceUpdate`). Typing into React's own node therefore means the
caret jumping to the start on each echo, the letters typed since coming back
out, and -- once a paragraph has been split -- React reconciling against a
tree it did not build.

So the element is hidden (`hidden`, and `display: none !important`, because a
class that sets `display` beats the attribute) and a deep copy stands in its
place: same classes, so the same look. The person types in the copy; React
goes on updating the hidden original. When the edit ends, the copy stays, no
longer editable, until the original shows the same text or
`INLINE_EDIT_SETTLE_MS` runs out, and then the original comes back. Without
that wait the old words flash back for as long as the last patch takes to
arrive.

Things that follow from it, each of which was a decision:

- **The copy keeps `data-val-path`**, so the bridge's scan still finds the
  field. The hidden original has no box and is skipped, as any hidden element
  is. Dropping the path would take the field out of "On this page" mid-edit.
- **Before the original when it is a first child, after it otherwise**, so the
  copy answers `:first-child` or `:last-child` as the original did. A
  `prose`-like stylesheet sets its margins by those.
- **The copy has no fiber.** A click in it would otherwise reach whatever
  React handler is on an ancestor (a card that navigates), so the bridge stops
  it in the capture phase, and the copy stops its own key events from reaching
  the page's shortcuts.
- **Content the server rendered** (a loader, a server component) only moves
  after the round trip `confirmed` starts, which can outlast the wait. The old
  words then show briefly after the edit ends. Nothing is lost: the patch was
  written.

## Plain text, and three things done by hand

The copy is `contenteditable="plaintext-only"`: the browser never invents
markup, so every element in the copy is one the document had (it carries its
node's index, `data-val-inline-node`) or one this code put there. Reading the
copy back is then a walk: an element keeps everything about its node but its
children, which are read afresh.

Three things the browser's plain-text editing gets wrong for a richtext, and
which `inlineEditing.ts` therefore does itself:

- **Joining two blocks** (Backspace at the start of one, Delete at the end, a
  selection across them). The browser moves the second block's TEXT and
  leaves its marks and links behind. Measured in Chromium, and the reason
  `deleteRange` exists.
- **Enter.** Plain text gets a `\n`. A richtext gets a second paragraph,
  heading or list item, made with `Range.extractContents`, which splits the
  marks the caret was inside. At the end of a heading it is a paragraph.
- **Paste.** Text only, and a line break is a space.

## Formatting: the Studio's controls, on the page's selection

A richtext being typed in has the column editor's own buttons
(`ToolbarButtons`) floating by it, for what the field's schema allows: bold,
italic, strikethrough, links, headings, lists. They are drawn by the STUDIO,
over the preview, not by the page: the page is the customer's document with
none of the Studio's styles, and it may be shown at a quarter of its size.

That splits the work across the frame, and each half does only what it can:

- **The page says what is selected** (`inlineEditSelection`): as a place in
  the document -- which paragraph or heading, counted in reading order, and
  how far into it, a character as one and an image or line break as one.
  That is how ProseMirror counts inside a text block too, so
  `inlineSelectionMapping.ts` is a few lines and neither side knows how the
  other holds the document.
- **The Studio makes the change.** `CanvasInlineRichTextToolbar` keeps a
  ProseMirror editor nobody sees (`DetachedEditorView`), its document and
  selection whatever the page last said, and the buttons act on it. So Bold
  here is the same transaction as Bold in the column, links come from the
  same picker, and nothing about marks or lists is implemented twice. The
  result is written at once -- not on the typing debounce -- and sent to the
  page (`applyInlineEdit`).
- **The page shows it** (`apply` in `inlineEditing.ts`), twice. At once, with
  what it can tell of the page's look: a new node is classed as a node of
  its kind already in the document is, and where there is none a mark gets a
  plain inline style. Then exactly, from the hidden original, once the page
  has rendered the very document the copy holds (`refresh`) -- the original
  is always the page's own rendering, so it is where the theme's classes
  come from. Never while the two differ: what the person is looking at stays.

### The field's validation errors, by the text

What the field's row in the column says is wrong with it, it also says by the
text being typed in: a label that may not end in a space says so as the space
is typed, where the person is looking, and stops saying so when it is
deleted. The same errors, read the same way (`useValidationErrors`, which is
also what makes them be worked out), so the two never disagree.

Drawn by the Studio, for the reason the controls are, and in the SAME box as
the controls (`CanvasInlineEditFloat`): two boxes placed each by itself would
both want the room above the text and one would land on the other. Between
the bar and the text, when the box is above it. A string has no controls, so
for a string the box is the errors alone, and nothing is drawn while there
are none.

So the page reports where a STRING is too, not only a richtext
(`inlineEditSelection`, with no selection: `null`). The bridges relay that
report for any kind already, so the widening is in `inlineEditing.ts` alone.

### Where the controls go

Above the text, with its left edge. Where that does not fit they go below it,
and where neither fits -- a text taller than the preview -- inside the
preview's edge, on the side away from the caret. Never outside the part of the
preview that is on screen (`placeInlineToolbar`, which is pure and tested), and
not at all while the text is scrolled out of it. The errors go wherever the bar
goes, as part of its box. What opens OUT of the bar (the
link picker) is not part of the bar's box: a bar that grew a list of pages
would be moved away from the text to make room for it.

They float, so above a text means over whatever the page has above that text.

`CanvasFrame` is what knows where the text is (`onInlineEditPlace`): the frame
is scaled and panned, and the page only knows positions inside itself. The
layer asks every animation frame and moves the box by hand, since a zoom or a
scroll changes the answer without anything being told.

### Who ends an edit

The focus leaving the page does NOT end it any more: the controls are out
there, and a box to type a link in has to take the focus. So:

- on the page, Enter (a single line), Esc, or a press anywhere outside the text
  ends it;
- in the Studio, a press anywhere but on the controls ends it (`CanvasFrame`
  sends `stopInlineEdit`), with one exception: the preview's controls that
  change only how the page is LOOKED at -- zoom in and out, fit, the device
  widths, and the window it is scrolled and pinched in, all marked
  `PREVIEW_VIEW_CONTROL_ATTRIBUTE`. Someone zooming in to see what they are
  typing is still typing it. The floating controls follow the text, and once
  the press is over the caret is put back in it (`focusInlineEdit`). The
  reload, the address bar, Exit Preview and turning Select off do end it:
  each replaces the document the caret is in or leaves the mode. What was
  typed is written as the edit ends, whichever ended it;
- and the Studio says when the caret should go back (`focusInlineEdit`): a
  document that lost the focus to the one around it has forgotten which of its
  elements had it.

Not `document.hasFocus()`, which looked like the way to tell "the focus went to
the Studio" from "a click on nothing in particular": for a document in a frame
it goes on answering yes wherever focus is emulated, Playwright included.

## A text left empty is still there to click

An emptied heading is `<h1 data-val-path="…"></h1>`, with no height, so
there was nothing to click: not to pick it in Select, not to type in it again
in Select & edit. While Select is on, in either mode, an element showing a
string or richtext the Studio says is empty (`textFields`' `empty`) and
nothing else is marked (`emptyTextFields.ts`), and the picking stylesheet
gives it a line of room: a minimum height for a block, padding for an inline
element.

It is the one rule there that moves the page -- the rest is outlines,
because outlines cannot -- and it is kept narrow on purpose: only while Select
is on, only for what the Studio says is an empty text right now (the page
cannot tell a text from a spacer), never an element that is empty by nature
(`img`, `input`, `source`...), and only while the element still shows
nothing. The room is the line it takes once it holds text again.

## What it does not do

- **No images from the page.** The controls have no image button: uploading
  from here into a document shown somewhere else is its own piece of work.
  Images a document has are kept, and can be deleted with the keyboard.
- **A mark needs a selection.** Bold with only a caret changes nothing: the
  editor remembers it as a mark for the next character, and that memory does
  not cross the frame.
- **Undo stops at a control.** The browser's own undo works while typing. A
  control replaces what is in the copy, and the browser's history goes with
  it, so neither the control nor what was typed before it can be undone on
  the page.
- **Other tags.** A document holding a tag outside `p`, `h1`-`h6`, `ul`, `ol`,
  `li`, `span`, `a`, `br` and `img` is not edited on the page at all.

## Testing it

jsdom has no layout and no editing, so the unit tests
(`inlineEditing.test.ts`, `inlineEditKeys.test.ts`, `emptyTextFields.test.ts`,
`canvasBridgeInlineEdit.test.tsx` and `canvasBridgeElements.test.tsx` in each
binding, `canvasInlineEdit.test.tsx`, `canvasInlineFieldErrors.test.tsx`,
`inlineEditCandidates.test.ts`, `canvasTextFields.test.ts`) mutate the copy
and dispatch `input`, which covers the protocol and the reading-back.
What the keys themselves do is only true in a browser -- typing straight
after a click, and clicking an emptied text, included:
`e2e/inlineEditingSuite.ts` types into the blog page both example apps have,
once per framework (`inline-editing.spec.ts`, `inline-editing.next.spec.ts`),
since the page's half is a copy per binding.
