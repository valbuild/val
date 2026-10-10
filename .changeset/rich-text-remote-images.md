---
"@valbuild/shared": patch
---

Fix existing remote images in rich text being saved as `/publichttps://…`.

Editing a rich text field could rewrite every remote image already in it into a
broken path when the field was not set up to upload remote images itself — for
example before the project's remote file settings had loaded, or when the
field's image schema is not `.remote()`. A published remote image is now kept
as it is, whatever host it is on.
