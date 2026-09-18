---
"@valbuild/ui": patch
---

Tighten the Studio's preview spacing: one gap under the phone's mode switch, one gap either side of the desktop divider

On a phone the three modes each started somewhere different under the strip of
switches, because the track cleared the strip and then every pane added a gap
of its own on top: the address bar sat 38px below the switches, the module
editor 26px. All three now start 12px below it — the same 12px the strip and
the panes are inset from the sides of the screen — which gives the page 26 more
rows of itself on the one screen size that has none to spare.

On a desktop the canvas sat 6px from the divider's line and 12px from the
right edge of the window, so the divider looked nudged towards the page. The
divider's own hit area is 12px wide with the line down the middle, so the
canvas now adds the 6px that makes both sides 12px.

Also: a field scrolled to in the phone's module editor no longer lands 96px
down the pane. That clearance exists for a column running up under the floating
top bar, and the phone's pane already starts below everything covering it.
