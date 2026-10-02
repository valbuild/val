---
"@valbuild/ui": patch
---

Publishing a Git-connected project from an iPhone or iPad now builds the site in the browser instead of waiting for CI. Safari, and every other browser on iOS, can't run the site build on the Studio's own page, so the Studio opens a builder tab and builds there, as it already did for projects without a repository. Before this, a publish from a phone only went live when the repository's CI build finished.
