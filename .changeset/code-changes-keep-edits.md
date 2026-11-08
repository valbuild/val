---
"@valbuild/ui": patch
---

An edit is no longer lost when the code of the content it belongs to changes.

- **A field just added in code can be edited straight away.** In local
  development the page and the server pick up a changed `.val.ts` in either
  order. When the Studio had the new field first, an edit to it was made
  against content that did not have the field yet, and was discarded with
  "An edit could not be applied". The Studio now keeps reading the content its
  own code wrote until the server has the new code too, so the edit is kept.
- **An edit to a field the code renamed or removed is kept, not deleted.** It
  is shown above the Studio ("An edit does not fit the new schema"), with the
  field it was made to and a button to discard it. Publishing waits until it
  is settled, rather than throwing it away. An edit that could never be
  applied is still removed, as before.
- **In a proposal in code mode, the Studio reads the code the assistant
  writes.** After each change it evaluates the project's `val.modules` in the
  browser (where the Studio can run its builder) and takes the new schema in,
  so a field the assistant adds can be filled in before the proposal is
  built. The assistant is told which modules' schema changed, which content
  does not fit its new schema, or why the code does not run, and a `.val.ts`
  that throws leaves the Studio on the schema it had.
- **A `val.modules` that cannot be read at all** (it throws) no longer leaves
  the Studio half updated: it keeps the code it had and says why.
