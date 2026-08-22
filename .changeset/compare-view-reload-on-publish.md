---
"@valbuild/ui": patch
---

Reload the compare view when changes are published.

Publishing commits the patches the compare view is diffing and moves the base they are diffed against, so the comparison on screen is stale as soon as a publish goes through — but it stayed there until the next stat poll happened to invalidate the patch sets from under it.

The sync engine now counts successful publishes and exposes that as a subscribable signal (`usePublishCount`), which the compare view takes as a reload key: `usePatchSetsWorker` drops the trees it had computed and rebuilds them from the fresh patch sets, so the view shows its loading state and then the post-publish result. The counter deliberately survives `reset()` — it is monotonic for the lifetime of the engine, so a reset can never make a reload key repeat a value it has already had.
