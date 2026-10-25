---
"@valbuild/shared": patch
"@valbuild/ui": patch
---

The Studio's deploy, the publish job a tab runs, a proposal's build and a proposal's typecheck are now `@valbuild/shared/publish` and `@valbuild/shared/typecheck`, so home's upgrade page can build, check and publish an upgrade with the same code, pinned at a version of its own. The clients reach content through the Studio's proxy as before, or directly (`publishApi`, `proposalsApi`) with a `fetch` that adds the credential. Nothing changes in the Studio.
