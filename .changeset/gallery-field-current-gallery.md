---
"@valbuild/core": patch
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/ui": patch
---

An image, file or video picked from a gallery is checked against the gallery as it is now. Picking one uploaded since the site was built (still unpublished, saved in a proposal, or published without a rebuild) used to fail with "The gallery does not have an image at …" and refuse the save. In a proposal, Save now reads "Fix N" and goes to the validation errors instead of being refused by the server, as Publish does on the site.
