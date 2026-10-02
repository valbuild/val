---
"@valbuild/ui": patch
"@valbuild/shared": patch
---

When a publish fails because the Studio could not build the site, the editor is now told why. The tab that built it sends its reason with the failed step, so the message reads, for example, "build failed 3 times: Tailwind's '@plugin' is not supported here…" instead of just "build failed 3 times". This needs the content service that accepts the reason; an older one ignores it and shows the message as before.
