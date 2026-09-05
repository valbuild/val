---
"@valbuild/ui": patch
---

Show your own name on the changes you have just made.

In a hosted project, a change made in the Studio showed up under "Unknown
author" as soon as it was made, next to earlier changes that were correctly
attributed. Reloading the page fixed it, which is what made it look arbitrary:
whether a change had an author depended on whether it had been fetched from the
server or made in the tab you were looking at.

A patch created in the browser carried no author at all. The server stamps one
from your session when the patch is saved, but the Studio never re-fetches a
patch it made itself, so nothing in the tab ever learned who wrote it — the
change history, the author avatars on a field and the review screen all grouped
it under an author they could not name.

Such a patch is now stamped with the current profile as it is created, which is
the same author the server records for it.
