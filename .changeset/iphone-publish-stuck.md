---
"@valbuild/ui": patch
---

Publishing from an iPhone no longer gets stuck on "Starting the publish".

On a phone, Publish opens a builder tab to build the site, and iOS pauses the page you pressed Publish on as soon as that tab opens. That page used to be the one that started the publish, so the builder tab could wait for it indefinitely. It happened most often when you pressed Publish right after making a change, while that change was still being saved. The builder tab now starts the publish itself, waits for your last change to be saved first, and the page you came from picks it up when you go back to it. "Try again" on a failed publish and "Update site" work the same way.

If something does go wrong, the builder tab now says what happened and what to do instead of spinning: a publish that could not reach Val is retried, and one that cannot go ahead says why.
