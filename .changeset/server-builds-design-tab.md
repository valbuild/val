---
"@valbuild/shared": patch
"@valbuild/ui": patch
---

**Proposals can be built by Val Build instead of in your browser.** When Val Build builds your project's proposals, the design tab's **Build** and the assistant's `build_proposal` in the design tab ask it to build the proposal, and the Studio waits until the build is served at the proposal's address. A small code change is built, checked and on the proposal's page in a few seconds, against around twenty for the build alone in the browser. Nothing is downloaded first, no builder tab opens on an iPhone or in Safari, and closing the tab does not stop the build.

Val Build is turning this on project by project, in the design tab first. Until it is on for yours, Build works as before, in the browser, and so does Build in the proposals bar.
