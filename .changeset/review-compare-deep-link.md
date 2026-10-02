---
"@valbuild/ui": patch
---

The compare dialog on the review page can now be linked to. `/val/review?compare` opens it, and `/val/review?compare=<source path>` opens it on that change and highlights the row. Closing the dialog removes the parameter from the URL. A link to a change that isn't staged opens the review page without the dialog, so the change shows under Unstaged.

"View in Compare" in a media gallery's file properties now uses this: it's a real link that opens the dialog on that file's change, instead of going to the old compare view. It also appears for files whose only change is the description (alt text). Before, an edited description didn't count as a change, so neither the link nor the file's authors were shown.
