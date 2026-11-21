---
"@valbuild/ui": patch
---

**Typing in the Studio no longer stutters.** A field saves a moment after you stop typing, and every couple of seconds while you keep going. Each of those saves used to redraw the whole Studio, several times over, and again when the server confirmed it, so typing froze for a moment in the middle of a word. A save now redraws the field you are typing in and the few places that show it: the save indicator, the count on Review and Publish.

On the page this was measured on, one save went from redrawing about 13,000 components to about 300.
