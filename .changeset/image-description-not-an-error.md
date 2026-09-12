---
"@valbuild/ui": patch
---

An empty image description is no longer marked as an error

The Description field of an image field showed a red **Missing** next to it
whenever it was empty. Val has no rule that alt text is required, so nothing in
validation reports that — the badge claimed an error the validator never
raises, on every image field that had not been given a description. It is gone.
If a schema ever does require alt text, that arrives through the ordinary
validation error path, which the field already shows.

The **Use the filename** shortcut next to it is gone with it. It only ever
appeared alongside the badge, and a filename says what the file is called
rather than what the picture shows, which is the one thing the field is asking
for.
