---
"@valbuild/ui": patch
---

The compare dialog -- "Review changes" on the review page, and "Compare with the site" in a proposal -- can be scrolled again. Every modal dialog in the Studio cancelled the mouse wheel over its own content, because its scroll lock could not tell from outside the Studio's shadow root that the wheel was inside the dialog.

Dialogs that did not set their own background are no longer see-through: the compare dialog showed its text straight over the blurred Studio behind it.

An image added to or removed from a gallery is shown in the compare dialog as the image, with its file name, size and alt text, instead of as its width, height and mime type.
