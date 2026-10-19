---
"@valbuild/ui": patch
---

Review changes now works on a phone. On anything narrower than 1024px the
compare dialog fills the screen and shows one side at a time, with the list of
changes in a drawer. Before, it squeezed the desktop layout into the screen
and every value wrapped one letter per line. On a touch screen each change's
Revert (or Restore) button and its authors are always shown, since there is
no hover to reveal them.
