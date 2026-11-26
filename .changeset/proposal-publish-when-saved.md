---
"@valbuild/ui": patch
---

In a proposal, the main button says Publish once everything is saved

When a proposal had nothing left to save and its preview was up to date, the main button stayed a greyed-out Save, and Publish was only in the menu beside it. It now says Publish, on a phone as well as above one, and pressing it opens the publish dialog, which shows what will be published and asks before anything reaches the site. If validation errors would stop the publish, the button says "Fix N" and takes you to them.
