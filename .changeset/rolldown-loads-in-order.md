---
"@valbuild/tanstack-build": patch
---

Building a site in Safari (and every browser on an iPhone) no longer fails with "Cannot access '…' before initialization". The browser build loaded rolldown's bundler and its parser at the same time, and Safari could hand back the bundler before it had finished loading; they now load one after the other.
