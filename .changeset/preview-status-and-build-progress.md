---
"@valbuild/ui": patch
"@valbuild/shared": patch
---

In code mode:

- **Build progress.** While Val Build builds the preview, the Studio shows how far it is: waiting in the queue, then the builder's steps ("Building the site"), then checking the page and serving it. The refresh button beside the preview fills as a ring as the build goes, and its tooltip says the step and the percent.
- **The preview's refresh button is just the icon.** The words that sat beside it ("Up to date", "Save to update", "Updating 42%") are gone. The state shows on the icon itself: it turns while updating, fills as a ring while building, shows a dot when Save would update the preview, and turns red when the preview could not be updated. The tooltip and screen readers still say it in words.
- **The `</>` button on the site** is the same size as the other buttons in the top bar.
