---
"@valbuild/shared": patch
"@valbuild/cli": patch
---

`val publish` builds the site's dependency layer with Val Studio's files served by the platform, as the platform asks. Until now `val publish` dropped that request when it read the build target, so every layer it built carried the whole Studio inside its server code: on a hosted site that is 80–100 MB of each server instance's 128 MB, and the site was started from scratch on nearly every request, answering in 2–4 s. Publish once with this version and the next build sends a new, much smaller layer.
