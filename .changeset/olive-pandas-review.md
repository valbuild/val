---
"@valbuild/ui": patch
---

A review page for what is about to be published, and a compare dialog beside it

Review used to open a diff. A diff answers "what changed"; the decision in
front of an editor about to publish is "what is going out", which is made over
the whole list at once — so Review now opens `/val/review`, a page of exactly
that, with the diff one click away.

- **Staged and unstaged, everywhere.** Two sections, with one vocabulary
  behind them: a change is staged or it is unstaged, and nothing is "held
  back" any more. What each means is in a tooltip on the heading rather than a
  paragraph under it.
- **Selection, filters and authors.** Rows are multi-select with presets, the
  list can be narrowed to one author, and an author is shown with the same
  avatar the rest of the Studio uses.
- **Revert without leaving the page**, over the current selection or over
  everything.
- **Compare works in `fs` mode.** The dialog compares the staged changes
  against what is on disk — there is no published history to compare against
  there, so it does not offer one, and it says "save" where a deployed project
  says "publish".
- **History is a route** (`/val/history`) rather than a panel, so a commit — or
  the list you pick one from — can be linked to. It stays hidden in `fs` mode,
  where restore is not supported.

Nothing in any of these screens shows a module file path. A page is named by
its URL and located by it; a data module is named by its own name and located
by its folders, spelled the way the left nav spells them.
