---
"@valbuild/ui": patch
---

Publishing now says how far it has got, and works from the overlay.

- **Progress.** A publish built in the Studio shows the step it is on and how long it has run, in the status bar: loading the builder, building, uploading _n of m_, checking the site renders, going live. After it goes live the Studio waits until the site actually serves the new build where you are, and only then says "Live after 42s". A Cloudflare location can serve the previous build for up to a minute. Each publish also logs its steps and their durations to the browser console.
- **Publishing from the overlay.** A page of the site cannot build: the bundler needs a cross-origin isolated document, and only the Studio is one. So the overlay's Publish, after you write the message, opens a Studio tab that builds and publishes the commit. A card on the page follows it to "Live after 42s". Before, a publish from the overlay was committed and then stayed at "deploying". If the browser blocks the tab, the card offers it as a button; nothing is lost.
- The overlay's Publish button is round, the size of the buttons beside it.
