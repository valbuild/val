---
"@valbuild/ui": patch
---

Changing a field back to its old value after publishing no longer disables Publish. Between a publish and the deploy that follows it, the Studio compared edits against the deployed content rather than what had just been published, so changing "Old Value" to "New Value", publishing, and then changing it back to "Old Value" was treated as "no changes" even though publishing would change the field.
