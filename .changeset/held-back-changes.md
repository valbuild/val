---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

A publish that breaks a page no longer stops everyone else publishing. On val.build, the changes it had are held back: the Publish button says how many, and publishes go without them until someone presses Try again or Discard on the failed publish.

Publish can be pressed while this tab is still building the last publish. The new publish waits its turn and is built when the current one ends.

Discarding a change that is being published now says so, instead of failing silently. From there you can cancel the publish, which then discards the change, or wait for the publish to end.
