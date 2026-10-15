---
"@valbuild/shared": patch
"@valbuild/cli": patch
"@valbuild/ui": patch
---

`val publish` and the Studio now tell Val Build which version of the platform's React and TanStack a build was made against. If the platform is updated while a build is running — a project's CI can take several minutes — that build is no longer published onto a platform it was never checked against: the publish stops with a message saying the platform was updated and to build again, and the next build is checked against what it will run on. A build published with `val publish --artifacts` was made elsewhere and does not say, and publishes as before.
