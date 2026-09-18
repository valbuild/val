---
"@valbuild/ui": patch
---

The canvas now shows the page at the width of the pane, from the top

The preview opened zoomed further out than it needed to be, with empty canvas
down both sides. It was fitting the WHOLE page into the pane, and a page is
given the height of a viewport — so the height was usually the side that ran
out first, and the width paid for it. A 24px margin on every edge came off the
top of that.

It now fits the width and pins the top: the page reaches both edges of the
pane and starts where the page starts. What does not fit is a scroll away, and
zooming out to see more of it at once is still the `-` button. A layout
narrower than the pane — a phone width, most obviously — is shown at 1:1 and
centred rather than blown up past life size.

The fit button (now "Fit page width") is the way back to that view from
anywhere, and it works after scrolling as well as after zooming. Holding the
fit as the pane is resized no longer scrolls the page back to the top, so
dragging the split divider while reading half way down a page keeps your place.
