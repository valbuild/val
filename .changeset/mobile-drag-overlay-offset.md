---
"@valbuild/ui": patch
---

Fix dragging a list row on a phone, which picked the row up well below the
finger and dropped it about three rows too far down.

The card that follows your finger is positioned against the viewport, and on a
phone the editor and the page ride on a track that was transformed even while it
was standing still. A transformed box becomes the reference point for everything
positioned that way inside it, so with the preview open the card was placed
against a box already pushed down by the strip of switches — 132px of it. The
same offset decided where the row landed, which is why the drop missed by
roughly three positions.

The track is now only transformed while it is actually moving between the
editor and the page.

Drag handles also declare `touch-action: none`, as dnd-kit asks them to. Without
it a phone can decide mid-drag that your finger meant to scroll, and from that
moment the drag and the list move at the same time. The rule had been written as
an HTML attribute rather than as CSS, so it had never taken effect.
