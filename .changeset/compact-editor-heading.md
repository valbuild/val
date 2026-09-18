---
"@valbuild/ui": patch
---

The editor's heading is compact when the canvas is open

Beside the preview the editor is one of three panes that begin on the same
line, and the other two start using their space immediately: the address bar is
a control you type in, the On page header is a count and a filter. The module
heading spent 124px before the first field to say one short name — a 24px title
with 16px of padding over it and a 24px gap under it — which next to those does
not read as a heading with presence. It reads as a pane that has not loaded yet.

It is now 80px there: the same three lines (title, subtitle or route, scope),
the same fixed height whatever a developer wrote, the same square thumbnail —
scaled down, 24 + 16 instead of 32 + 20, with the padding above and the gap
below following. With the canvas closed the editor is alone on the screen and
nothing changes; the heading leads, as it should.
