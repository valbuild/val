---
"@valbuild/ui": patch
---

Publishing from the Studio no longer opens a second tab, and a failed publish says what happened in plain words.

- **Only the overlay opens a Studio tab to publish.** The Studio used to open one too when it could not build in the current browser, which only gave a second page with the same failure.
- **A failed publish leads with a sentence,** such as "This browser cannot build the site, so it could not be published from here", with the technical message under **Details**. This applies to the Studio's error, the publish tab and the overlay's card.
