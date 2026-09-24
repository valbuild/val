---
"@valbuild/ui": patch
---

Publishing works in Safari and on iPhone, and a failed publish says what happened in plain words.

- **Safari and iOS can publish.** WebKit does not support the header that lets the Studio build in place (`Cross-Origin-Embedder-Policy: credentialless`), so a Studio in Safari, or in any browser on an iPhone, could not build at all. Its Publish, and Finish publishing, now hand the build to a small builder tab. The Val platform isolates that tab in every browser, and it closes itself once the change is live. Chrome, Edge and Firefox still build in place and open no tab.
- **A failed publish leads with a sentence,** such as "This browser cannot build the site, so it could not be published from here", with the technical message under **Details**. This applies to the Studio's error, the builder tab and the overlay's card.
