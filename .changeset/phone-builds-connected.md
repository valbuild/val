---
"@valbuild/ui": patch
---

Publishing a Git-connected project no longer locks the Studio while it waits for CI, and works from a phone.

- The Publish button stays available while a publish waits for the server or for CI. You can publish your next changes straight away, and they go out as a new publish. It is only held while this browser is building or uploading.
- On an iPhone or iPad, the Studio now builds the site in a separate builder tab instead of waiting for CI. Safari, and every other iOS browser, can't run the build on the Studio's own page. Projects without a repository already worked this way.
