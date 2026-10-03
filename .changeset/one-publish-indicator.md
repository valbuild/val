---
"@valbuild/ui": patch
---

Publishing has one indicator in the Studio's status bar, and it spins until every visitor sees the change.

- **Publishing 42% → Reaching visitors 94% → Live**, with a progress bar. Live is not the end: each edge may serve the previous version for up to a minute after the site switches, so the indicator keeps spinning, and the bar keeps filling, until that has passed. When it stops, every visitor sees the change. The step ("Building", "Uploading 3 of 7") is on hover.
- **It spins for anyone's publish**, not only yours: another editor's publish shows here too.
- **One "Published" toast**, for the person who published, when every visitor sees the change, instead of at the moment the site switched.
- **The Deployments list no longer opens by itself.** Click the indicator to see it.
- **Safari:** the Studio no longer shows a second progress card while the builder tab works. The builder tab now reports its percentage, so the Studio's bar matches it, and the card only appears when the tab was blocked or failed.
