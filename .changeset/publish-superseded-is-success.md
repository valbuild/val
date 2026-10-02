---
"@valbuild/cli": patch
---

`val publish` no longer fails when a newer publish is already live. Two publishes in a row start two CI runs, and the newer one can finish first. The older run is then told that the site already has its changes. It now prints that and exits with 0, instead of turning CI red.
