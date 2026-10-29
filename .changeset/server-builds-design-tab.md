---
"@valbuild/shared": patch
"@valbuild/ui": patch
---

**Proposals can be built by Val Build instead of in your browser.** When Val Build builds your project's proposals, the design tab's **Build** and the assistant's `build_proposal` ask it to build the proposal, and the Studio waits until the build is served at the proposal's address. A small code change takes about a second, against around twenty in the browser. Nothing is downloaded first, no builder tab opens on an iPhone or in Safari, and closing the tab does not stop the build.

Val Build is turning this on project by project. Until it is on for yours, Build works as before, in the browser.
