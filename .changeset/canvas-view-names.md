---
"@valbuild/ui": patch
---

The preview's two views are now called "Structure" and "On page"

They were "Normal" and "Fields", and neither said what it held. "Normal" said
only that the other one was not; "Fields" is what both of them are made of. The
difference between them is scope — **Structure** is everything in the module
you are editing, laid out as the content is built, and **On page** is the
fields the running page reported having on it — and the labels were the one
place a reader could have learned that and did not.

On a phone the three modes now read Structure · On page · Preview. Nothing else
changes: the `canvas-view=normal|fields` parameter is unchanged, so links
already copied out of the Studio still open the view they were copied from.
