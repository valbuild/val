---
"@valbuild/ui": patch
"@valbuild/server": patch
---

Publishing a proposal now says what blocks it, and what to do about it:

- When the site's code changed after a proposal with code changes started, the Publish dialog offers **Update from the site**. It moves the proposal onto the site as it is now, and its code then needs building again ("Build required").
- When someone published changes to the same page since the proposal started, the dialog names the fields each side changed.
