---
"@valbuild/ui": patch
---

Recent activity now shows publishes, not just edits

The Studio's Recent activity list only ever showed unpublished edits. Publishes
lived in the status bar's deploy feed, which is a live-progress indicator — it
closes itself once a build lands, and rows can be dismissed — so as soon as a
publish had finished, nothing in the Studio said it had.

Publishes are now rows in the same list, interleaved with the edits by time, so
the panel reads as what happened here: you changed the hero, it went out, a
colleague changed the pricing. A publish row carries the commit message (or the
short sha when there is none), who published it, and how the build is doing —
with the same labels and the same spinner/warning icons the deploy feed uses, so
one publish never reads two ways in two places.

Edits stay clickable and open the field they changed; a publish is a commit and
opens nothing, so it renders as a line rather than a button. Publishes take at
most three of the eight rows: an afternoon of publishing must not push out the
edits the panel exists to get you back to, and the full feed is still in the
status bar.
