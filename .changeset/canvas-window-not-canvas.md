---
"@valbuild/shared": minor
"@valbuild/next": minor
"@valbuild/ui": minor
---

Make the Studio canvas a window rather than a canvas

The canvas put the page on an infinite surface you dragged the background of.
That is the right model for a design tool and the wrong one here, and a phone is
where it stops being arguable: the page fills the pane, so there is no
background left to drag; dragging the page itself scrolls the page, correctly;
and what you are left with is a surface that can be moved by nobody and
stranded by anybody. Nobody ships a free-pan canvas on a phone — Shopify's theme
editor drops to a plain scrolling preview on narrow screens, Sanity's
Presentation tool keeps panning behind a modifier, and Figma, Framer and Webflow
are trackpad designs that have no touch canvas at all.

So it is a window now, on every screen size. The page sits inside it at the zoom
you choose and the window scrolls if it does not fit. Nothing floats, nothing
can be lost off an edge, and the scrolling is the browser's own — momentum,
rubber-banding and all. What the page itself looks like is unchanged: it still
keeps its own layout at its own width, so a 1280px page is still a 1280px page
while you zoom out to see all of it, and the dotted ground it sits on is still
there.

**Pinch to zoom.** One finger belongs to the page — it scrolls it, taps its
links, drags whatever the page put there. Two belong to the window, and a pinch
both zooms and moves the page inside it. Neither gesture can be mistaken for the
other, so nothing has to be moded. This needs the page's help: the canvas shows
the site in a frame, and a frame keeps its own touches, so a pinch there was
invisible to the Studio. `ValCanvasBridge` now relays two-finger gestures and
ctrl/cmd + wheel zooms over the protocol (`pinch` and `zoom` messages in
`valCanvasProtocol`), which is also what makes a trackpad pinch work over the
page rather than only over the background beside it. The page reports the finger
span in its OWN pixels — it knows nothing about the zoom it is being shown at —
so the Studio converts back to screen pixels before taking the ratio; left in
page pixels the gesture divides by its own result and a held pinch alternates
between two zooms instead of settling.

**Selecting on the page takes you to the field.** Picking was never an end in
itself — nobody outlines a headline to admire the outline — so a pick now opens
the fields column and scrolls the picked field into view, marked. On a phone it
also brings you to the pane holding that column, which it did not before: the
switch said "Editor" while the canvas stayed on screen, so a pick looked like it
did nothing. (The panes are a mandatory-snap scroller whose contents change as
the fields load, and a snap container re-snaps to the area it last considered
current whenever its contents change; the placement now holds its position for a
few frames, and the swipe detector no longer reads a position while one is in
progress.) The Normal/Fields and Select controls are unchanged, so reading the
page as a visitor would is still a switch away.

**A phone opens on the phone layout.** The device switch used to start on
desktop everywhere, which fitted a 1280px page into a phone-width pane at about
25% — a thumbnail, not a preview. It is the starting value only, so checking the
desktop layout from a phone is still one tap.

The `canvas-at` link parameter keeps its shape and still restores the zoom. Its
offsets are now a scroll position rather than a translation, so a link made
before this lands at the top left of the page it names instead of wherever it
had been dragged to.
