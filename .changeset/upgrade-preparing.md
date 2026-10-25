---
"@valbuild/ui": patch
"@valbuild/server": patch
---

**Create proposal** prepares an upgrade before its page opens. It creates the upgrade's proposal, works out the upgrade, and builds its dependencies, while the button says **Preparing…** with a line beneath saying where it is: for example "Building the dependencies · Installing the packages (1 of 2) · 212 of 412 packages", or how many upgrades are ahead of it while it waits for a builder. When the dependencies are built, the same tab goes to the upgrade's page, which starts at the build.

An upgrade that cannot be prepared says why, and its proposal is closed again. So is one that turns out to move nothing. Nothing on the site changes either way.
