---
"@valbuild/ui": patch
---

An upgrade of a site's dependencies now runs in a tab of its own, on every device, from the moment **Upgrade** is pressed until **Go to site**.

- The tab computes the upgrade, builds its dependencies, typechecks, builds and publishes it. It is served cross-origin isolated on every browser, so an iPhone builds and publishes there too, instead of opening a second tab for the build.
- When the upgrade is ready, **Review** opens its proposal in the Studio to see the preview and check the merge, and **Publish** publishes it directly. A step that fails says why, with **Try again** where **Publish** is. **Discard upgrade** closes the proposal.
- The Studio you started from says the upgrade is running, with **Open upgrade** to get back to its tab, and says when it is published. At the upgrade proposal's own address, **Open upgrade** goes back to the tab.
- An upgrade proposal is labelled "Upgrade" in lists, rather than "0 changes".
