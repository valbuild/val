---
"@valbuild/ui": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

Emptying a field in the preview's "On this page" list no longer removes it from the list while you are editing it.

The list shows what the page renders, and a field you empty often renders nothing: an empty rich text, an image set to none, or a link whose label was cleared. The row you were typing in used to vanish, taking your cursor with it, and clearing a link's label also removed its URL from the list. Now a field you have worked on stays where it was, marked "Not on page", until you reload the page with the canvas's reload button or go to another page. A field you delete from the content, such as a removed list item, still goes away at once.
