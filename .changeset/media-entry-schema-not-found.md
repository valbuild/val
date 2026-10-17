---
"@valbuild/ui": patch
---

The Studio no longer fills the browser console with `Schema not found for …`
errors on projects with an `s.imagedir()` or `s.videodir()`. The fields an
entry holds beside the ones the gallery edits (an image's `hotspot`, a video's
`poster`, `posterTime`, `startTime`, `endTime` and `captions`) were reported as
missing schemas on every change, thousands of times per page.
