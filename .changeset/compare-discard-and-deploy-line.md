---
"@valbuild/ui": patch
---

Discard all changes from the compare view, and a line where the deploy starts

Two things the compare view could not say, and one it could not do.

**Discard all had no way in.** `CompareSummaryStrip` — the count, the authors and
a Discard-all with a confirm — already existed, but only the classic layout
(`?val-ui=classic`) mounted it, in its sticky header. The floating shell renders
the compare view as the whole column and has no header to put it in, so in the
layout the Studio actually opens in there was no way to discard everything at
all. The shell now renders the strip above the changes.

The confirm says how much is about to go, and whose it is. "Discard all pending
changes? This cannot be undone." was true and never named a number:

```
Discard 12 changes?
All 12 unpublished changes in this project go away — including changes
made by Bob Bakke and Alice Andersen. This cannot be undone.
                                          [ Cancel ]  [ Discard 12 ]
```

**Committed patches were mixed in with pending ones, all of them offering a
Discard button.** In `http` mode a published patch stays in the chain and is
re-applied until the commit it went out in has been deployed and the server drops
it — so the view was showing work that is still yours and work already on its way
to production as one undifferentiated list. There is now a divider between them:

```
  /content/blog                                          ↶  🕐 2m ago  ⓐ
  ─────────  ⟳ Published & deploying  a1b2c3d · 2m ago — these cannot be discarded  ─────────
  /content/pages/landing                            🔒 Deploying  🕐 17m ago  ⓐ
```

Below the line the module is dashed, its discard controls are gone rather than
disabled — the commit exists, and there is nothing a Discard button could
honestly do about it — and Discard-all offers the pending subset only, so it
says "Discard 4", never "Discard 12". The pill carries the deploy itself
(building, live, or failed) from the same feed the status bar reads, so the two
cannot end up describing the same commit differently. A failed deploy locks what
is below it just the same. None of this appears in `fs` mode, where a published
patch is deleted rather than kept.

A patch set groups patches by the path they touch, which says nothing about
whether they have been published — so one set can hold a patch that shipped in
the last commit and a patch made a minute ago, and belong on neither side of the
line as a whole. `computeChangedSourcePaths` now splits such a set in two, and
each half derives its own authors and timestamp instead of inheriting the whole
set's. Discarding the pending half therefore leaves exactly what was published.
A module with work on both sides is two cards, one above the line and one below.

**And the view scrolled sideways on a phone.** Three fixes found by looking at it
at 360px:

- The container was `min-w-[380px]`, wider than the content box of a small phone,
  so the whole review scrolled horizontally before a single change had been read.
- Stacked before/after values were distinguished only by a coloured left rail,
  which read vertically as two list items rather than as old and new. They are
  labelled below `lg`, where the side-by-side layout's position and arrow are
  gone. The media variant already did this.
- The summary strip breaks into two rows, so the Discard button keeps its label
  instead of collapsing to a bare undo arrow beside other people's avatars, and
  the confirm's actions get a half-and-half row at a size a thumb can find.
