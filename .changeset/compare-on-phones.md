---
"@valbuild/ui": patch
---

Review changes now works on a phone. On anything narrower than 1024px the
compare dialog fills the screen and shows one side at a time, with the list of
changes in a drawer. Before, it squeezed the desktop layout into the screen
and every value wrapped one letter per line.

Reverting on a phone has its controls at the bottom of the screen: **Revert
all** and **Done** sit under the diff instead of above it, and each change has a
↶ button at the end of its row, next to who made it. On any touch screen a
change's undo action and its authors are always shown, since there is no
hover to reveal them.
