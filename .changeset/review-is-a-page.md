---
"@valbuild/ui": minor
---

Review shows what your changes change, on the page itself.

- **The differences are the page.** Review used to be a list of what was pending, with the differences in a dialog behind a button. It now opens on the differences, grouped by page and by content file, with only what changed: the words that changed in a text, the items that were added, removed, edited or moved in a list, the paragraphs that changed in a rich text.
- **Lists read as lists.** Inserting an item is one line, where it used to read as every later item changing. Reordering says which item moved. Renaming a record entry or a page's address is one rename, not a removal and an addition.
- **Inline or side by side.** A switch at the top shows each change marked in place, or the two sides in columns.
- **Reverting has its own page.** "Changes and revert" leads to the pending changes as a list you can select from, revert, and (where the project has proposals) publish a selection of. It is at `/val/changes`; a link to `/val/review?compare=…` still lands on that change.
- **In a proposal, Review is the same page**, comparing the proposal with the site. Its code changes are listed there whenever it has any, not only while code mode is on, so a proposal that changes only code has something to review. A page can be looked at before and after, side by side.
