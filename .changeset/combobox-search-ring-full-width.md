---
"@valbuild/ui": patch
---

Studio: the focus ring on a dropdown's search field now runs the full width of the box.

A ring is a `box-shadow`, so it is drawn around whatever element carries it — and the search input is not the search field you see. It starts after the magnifier icon and stops short of the row's padding, so the ring was a rectangle floating inside the popover with a gap down each side. It is on the row now, edge to edge, with its top corners following the box's own radius.
