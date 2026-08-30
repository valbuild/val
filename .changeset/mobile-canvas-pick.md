---
"@valbuild/ui": patch
"@valbuild/next": patch
---

Make picking a field on the mobile canvas land, every time

Tapping an element on the page in the phone's canvas was supposed to open its
field in the column beside it. Most of the time it did something else: the
workspace came to rest between its two panes, showing half the editor and half
the page, and stayed there — selecting a different page did not recover it, and
only closing the canvas did.

Four things were wrong. They compound, and the last is the one that made the
others survivable-looking rather than fatal.

**The page could scroll the studio.** After a pick the studio asks the page to
outline and reveal the field, and the page used `Element.scrollIntoView`. That
scrolls every scroll container between the element and the viewport — and for a
same-origin frame the chain does not stop at the frame, it continues into the
embedder. Measured in Chromium: with the panes placed on the editor, one
`scrollIntoView` inside the framed page pulls them back onto the canvas, and
because it is revealing an ELEMENT rather than a pane it can leave them anywhere
in between. The page now brings its own content into view by hand, one scrollport
at a time, and the walk stops at its own document.

**And it was asked to, for a field nobody needed to find.** The highlight that
follows a pick names the element the finger is still on. The studio no longer
asks for a scroll there, and does ask for one everywhere else — a row in the
fields column, a search hit, a validation error — where finding it on the page is
the whole point.

**A pick moved the workspace even when it opened nothing.** Opening the field and
going to the fields column ran one after the other unconditionally, in two
different owners. If the path could not be resolved — schemas not loaded yet, the
module gone, the page tagged with a path that no longer exists — the navigation
quietly did nothing and the workspace moved anyway, leaving a fields column in
front of you without the field it was opened for. The two halves are now ordered:
the pick either lands completely or changes nothing and says why, as a message
naming what failed and what to do about it. Each of the three reasons is told
apart, because each has a different next step.

**And a pick could close the canvas outright.** The canvas closed itself whenever
the selection was not a page, which is most picks: content on a real page mostly
lives outside the page's own route module — a footer, a setting, an author — so
picking any of those resolved to a data module and shut the canvas. The rule is
now whether the editor is on content the canvas page itself reported, which is a
list the page already sends.

Underneath all of it, the phone's panes are no longer a scroll position and a
piece of state that can disagree. They are one thing, with one rule: whenever the
panes come to rest, they are exactly on a pane — the one you swiped to if you
were swiping, and otherwise the one that was last asked for. The version this
replaces held the position for 400ms after each placement and then let go, which
covered the quick causes and none of the slow ones. There is no window now, and
nothing has to be quicker than the browser: whatever moves the panes, they are put
back.
