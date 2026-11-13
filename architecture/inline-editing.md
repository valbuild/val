# Editing on the page (beta)

With **Edit on the page** turned on (Account, under Workspace; one person's,
kept in `localStorage`), a click on a text in the Studio's preview puts the
caret in that text, on the page. Off, and for everything that is not a text, a
click opens the field in the Studio's column, as it always has.

Three parts, in three packages, and nothing else knows about it:

| part                                                                                                          | where                                                        | what it does                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `inlineEditing.ts`                                                                                            | `@valbuild/shared`, run by `ValCanvasBridge` of each binding | Makes an element typable, and reads what was typed back as the field's value |
| `editInline`, `inlineEditStarted`, `inlineEdit`, `inlineEditEnded`, `inlineEditUnavailable`, `stopInlineEdit` | `valCanvasProtocol.ts`                                       | The conversation across the frame                                            |
| `useCanvasInlineEdit`, `inlineEditCandidates`                                                                 | `@valbuild/ui`, `components/shell/canvas/`                   | Decides what to offer the page, and writes what comes back                   |

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

So the beta never takes a way of editing away. That is also what makes a
version skew harmless: `editInline` is a capability a bridge lists in `ready`,
and a page whose `@valbuild/next` or `@valbuild/tanstack` predates it is never
asked.

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

## What it does not do

Nothing new can be formatted on the page: no bold, no link, no image, no
turning a paragraph into a heading. A mark's class comes from the `theme`
passed to `ValRichText`, which only the page's renderer knows, so the copy has
no way to draw a mark the document does not already have. A document holding a
tag outside `p`, `h1`-`h6`, `ul`, `ol`, `li`, `span`, `a`, `br` and `img` is not
edited on the page at all. Both are what the Studio's own editor is for, one
click away.

The way past that is a real editor on the copy -- ProseMirror, with a schema
whose `toDOM` takes its classes from the hidden original, which is always the
page's own rendering of the current document. It was not needed to find out
whether editing on the page is worth having.

## Testing it

jsdom has no layout and no editing, so the unit tests
(`inlineEditing.test.ts`, `canvasBridgeInlineEdit.test.tsx` in each binding,
`canvasInlineEdit.test.tsx`, `inlineEditCandidates.test.ts`) mutate the copy
and dispatch `input`, which covers the protocol and the reading-back.
What the keys themselves do is only true in a browser:
`e2e/inlineEditingSuite.ts` types into the blog page both example apps have,
once per framework (`inline-editing.spec.ts`, `inline-editing.next.spec.ts`),
since the page's half is a copy per binding.
