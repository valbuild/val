---
"@valbuild/ui": patch
---

The AI model picker opens again, and shows even with one model on offer.

Its menu was portalled to `document.body` — outside the shadow root the Studio
renders in, where none of Val's styles reach it and nothing lifts it above the
overlay. The menu did open; it was invisible behind the Studio, which reads as a
trigger that does nothing. It now portals into the Studio's own container, like
every other popup there.

The picker also used to hide itself unless there were at least two models, so an
account with one reachable model had nothing telling it which model was
answering. It now renders whenever there is a model at all, and only disappears
when there are none — which means AI is off, not that there is no choice.

`DropdownMenuContent` now renders inline instead of portalling when it is given
no container — the posture `TooltipContent` already took — so this cannot
silently happen again: a clipped menu can be recovered from, an invisible one
cannot.
