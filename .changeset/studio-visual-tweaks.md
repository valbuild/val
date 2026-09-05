---
"@valbuild/ui": patch
---

Studio: duplicate a page, publish feedback on a phone, and a batch of visual fixes.

**Duplicate a page.** A page can be copied to a new URL from two places: the
Copy button beside its title, and a Copy button on its row in the Pages panel.
Both open the same route form the New page and Change URL controls use,
prefilled with the page's own URL, so the usual answer is one segment away — and
both go through one `copy` patch op, so the copy is the page rather than
somebody's second idea of what a page contains. Media comes along by reference:
duplicating a page with a gallery on it does not re-upload the gallery.

**Publishing from a phone says something.** The mobile bottom bar takes the row
the status bar would have had, so the deploy feed lived only inside the settings
sheet: the Publish button went back to "Publish" and that was the whole of the
feedback, with no way to tell a push that had landed from one that never went
out. The list now appears above the bottom bar when a publish goes out, and
closes itself once everything is live.

**Review is always in the quick actions.** It appeared only when something was
pending, which left "is anything of mine still unpublished?" unanswerable on a
phone — an empty row of quick actions looks the same as one that has not loaded.

**The compare view fits on a phone.** One long line used to scroll the whole
review sideways, and a long value pushed everything after it off the bottom.
Each compare box now scrolls its own content, and a read-only value in a dense
row is text rather than a disabled input — so a line longer than the box wraps
instead of being clipped at the right edge with no way to reach the rest.

**Author pictures show up everywhere they should.** The Studio had five ways to
draw a person, and the one in the top bar, the rail and the account panel drew
initials only — so the same author looked like two different people depending on
which surface you were on. There is one now, and it shows the profile picture
wherever there is one, falling back to initials.

Also:

- The AI chat keeps the caret in the composer when an answer completes. The
  composer is made non-editable while the assistant is answering, which drops
  the focus, and nothing put it back — so every follow-up question started with
  a click.
- A long tool name in the AI chat's tools row no longer pushes the row off to
  the right. Radix's scroll areas size their content as a table, which makes
  `truncate` grow the row to the full untruncated width instead of clipping it.
- A focused combobox no longer draws its highlight outside itself. The focus
  ring is painted outside the border box, so on a full-width trigger — and on
  the search input inside the dropdown — it landed on the enclosing field and
  was clipped or drawn over the box's own border.
- The deployments list no longer pops open for a publish that has been serving
  the site for more than ten minutes. It opens for a commit it has not seen
  before, which could not tell a publish that just happened from one that
  finished before the tab existed.
