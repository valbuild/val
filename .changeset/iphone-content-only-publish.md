---
"@valbuild/ui": patch
---

Publishing only text from an iPhone, or from the overlay on a site, no longer opens a builder tab.

A page that cannot build a site (every iOS browser, and the overlay) used to open a tab to build every publish. A publish that changes only content goes live on the build already there, so that tab did its first step and closed. The page now publishes it itself. A tab still opens, during the tap, when the publish adds or removes a file kept in the project. If the server decides the publish needs a build after all, a **Build in a new tab** button finishes that same publish.

The overlay now shows a card for a publish it makes itself: **Publishing**, then **Live after** a few seconds, or why it failed. If the publish needs a build after all, the card offers **Build in a new tab**.
