---
"@valbuild/ui": patch
"@valbuild/server": patch
---

Publishing from a phone is quicker to follow, and fails less.

- The builder tab closes once it has built and uploaded your change. Checking that the site renders and putting it live no longer need the tab, so you don't have to keep it open.
- After the builder tab closes you get one "Published" message, not three.
- If a publish fails, the builder tab gives the same reason as the Studio's message, not a vaguer one.
- A publish no longer fails with "This deployment cannot prepare a publish job for this project" when the site happens to answer from a server that hasn't loaded your changes yet.
