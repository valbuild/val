---
"@valbuild/ui": minor
"@valbuild/server": patch
---

The Studio has a **Validate** page, at `/val/validate`, and a button for it in
the top bar with the number of errors left.

It lists the errors the Studio already shows, as the errors page did, and adds
**Check everything**: a check of every module on the server, including whether
each image's and file's recorded size and type match the file itself. It runs
only when you press it, can be stopped, and its results stay for the session.

Where the Studio can make the fix itself — a missing or wrong width, height or
mime type on an image, file or video — the row has a **Fix** button. A fix is an
ordinary change: it shows up in Review, is published with everything else, and
can be undone from the row. Fixes that need a terminal show the
`val validate --fix` command to copy.

`/val/errors` still works and opens the same page.

Also fixed: `.jsonValues()` entries no longer report every image in them as
"not checked against the file" when validated on the server.
