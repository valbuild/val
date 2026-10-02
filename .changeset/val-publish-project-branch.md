---
"@valbuild/cli": patch
"@valbuild/shared": patch
---

`val publish` now wires the site at the project's branch, which the content service names, instead of the branch the checkout is on. The site's Val saves its edits to the branch it is wired at, so publishing a managed project from a feature branch made every Studio edit land where no publish looks, and Publish answered "nothing to publish". When the two differ, the CLI says so. With a content service that does not name the branch, the checkout's is used, as before.
