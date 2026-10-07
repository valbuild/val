---
"@valbuild/ui": patch
---

Publishing from an iPhone no longer gets stuck on "Starting the publish".

On a phone, Publish opens a builder tab to build the site, and iOS pauses the page you pressed Publish on as soon as that tab opens. That page used to be the one that started the publish, so the builder tab waited for it indefinitely. The builder tab now starts the publish itself, and the page you came from picks it up when you go back to it. "Try again" on a failed publish and "Update site" work the same way.
