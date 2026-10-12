---
"@valbuild/tanstack": patch
"@valbuild/ui": patch
---

A draft page no longer flips back to the text from before a content-only publish.

After content was published without a build, the Studio's overlay on a draft page started from the text compiled into the build, which still held the old content, and handed it to the page. Depending on which arrived first, an editor reloading the page saw the new text, then the old, then the new again, in a freshly opened tab and long after the publish. Visitors were not affected.

The page now hands the overlay the content it serves (`ValDraft.base`, from the content version and any proposal's saves), and the overlay starts from that instead of the build's text, so the two never disagree.
