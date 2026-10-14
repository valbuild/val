---
"@valbuild/ui": patch
---

A proposal's code can be built from every browser, an iPhone included. Where the Studio cannot build itself (Safari, and every browser on iOS), **Build** hands the build to a builder tab at the proposal's address, as Publish does, and follows it to the end. If the browser does not let the tab open — the assistant's `build_proposal` is not a tap — the button becomes **Open the tab to build**.
