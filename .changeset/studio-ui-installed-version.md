---
"@valbuild/tanstack-build": patch
"@valbuild/cli": patch
---

`val publish` now declares `@valbuild/ui` at the version your project actually runs. A project that does not declare `@valbuild/ui` gets it added when it is wired for the platform, because the Studio's bundle lives there. It used to be added at `@valbuild/core`'s version, which can be an older release than the `@valbuild/ui` your `@valbuild/tanstack` uses. The two are no longer always released together, and the mismatch could install a second, older Studio. It now takes the version installed beside `@valbuild/tanstack`, and if no installed copy can be found it says so in a warning. A project that declares `@valbuild/ui` itself is left unchanged.
