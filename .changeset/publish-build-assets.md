---
"@valbuild/shared": patch
"@valbuild/cli": patch
---

**`val publish` no longer puts Val's Studio inside a hosted site's server code.** The build target Val's hosting sends says whether the platform serves the Studio's files itself (`buildAssets`), but `val publish` dropped that field while reading it, so every layer it built carried the whole Studio: about 80 MB of a hosted isolate's 128 MB, enough that the site was started again on nearly every request and took seconds to answer. Val's hosting now refuses such a layer, so publishing from the CLI failed with "carries Val's Studio inside its server code". With this release the layer is built without the Studio, the platform serves its files, and the site's isolate stays warm.

A field the hosting adds to the build target and the CLI does not read is now a compile error in Val itself, so this cannot happen silently again.
