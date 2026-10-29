---
"@valbuild/shared": patch
"@valbuild/ui": patch
---

**A quick preview now shows layout changes, not only text.** A quick preview loads the proposal's new code into a page the last build rendered on the server. React kept that page's markup wherever only attributes differed, so a change to classes (a layout made horizontal, a gap, a colour already in the site's styles) showed nothing, while a change to text did. The page is now rendered from the new code instead.

The design tab's assistant no longer offers `screenshot_page`, whose picture never came back from the page. `read_page` gives it the computed styles, sizes and positions it was for.

The assistant builds a proposal far less often. A quick preview shows components, layout, styles, text and content. It builds only for what a quick preview can't show, such as an added or renamed route, code that runs on the server, a schema or dependencies, and otherwise once, when a request is finished.
