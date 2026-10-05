---
"@valbuild/ui": patch
---

Pressing Save or Publish while your last edit is still on its way to the server no longer fails with "Cannot publish: your latest changes could not be saved". Before, the Studio gave that edit 5 seconds to arrive. A save that was only slow was then refused as if it had failed, even though the change reached the server a moment later and the status bar said "All changes saved".

This happened most often in local development, when you saved twice in a row: saving rewrites your `.val.ts` files, the dev server recompiles, and the next save waits for that rebuild.

The Studio now waits for a save that is still in progress. It stops waiting, and tells you, only when the save has actually failed.
