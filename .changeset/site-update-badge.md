---
"@valbuild/ui": patch
---

When a site hosted on Val Build has an update available, the Studio now says so without anyone opening Settings. The Quick actions button carries a badge with the number of packages that would change, both in the top bar and in the bottom bar on a phone. The first row inside it is **Show updates**, with the same badge.

Show updates opens a dialog that names what moves (Val as one line, everything else folded away), says what will happen, and runs the update only when someone presses **Update site**. While the update runs, the dialog shows which of three steps it is on: rebuilding, checking, going live. It ends with a reload, or with what went wrong and **Try again**. On a phone the dialog is a full-height sheet, and on an iPhone it says that the update builds in a tab of its own.

Only people who can publish see any of this. Settings → Updates still works and shows the same state.
