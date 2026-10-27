---
"@valbuild/ui": patch
"@valbuild/core": patch
"@valbuild/shared": patch
---

Proposals in the Studio, reworked:

- **Save becomes Publish.** In a proposal, one split button stands where Publish is on the site. Its main half is the next step (Save, then Build, then Publish), and its caret offers every step, so you can publish straight away: Publish saves first. The separate Publish button beside the switcher is gone.
- **The switcher is where the proposal is managed**, as on a phone: its name and changes, Compare with the site, Rename, Copy link and Close, then where else to go.
- **Upgrade proposals** have one Publish (the bar's), say what they upgrade in the Publish dialog, cannot be published while Val Build is still working them out, are discarded rather than closed, and have their own icon.
- **A published proposal** shows a dialog with the ways out (the site, a new proposal, all proposals), since nothing more can be done in it.
- **Notices about where you are** (an upgrade, an upgrade under way, a restore) pop up from the bottom right and stay until dismissed; a dismissed one folds into the status bar and comes back from there.
- **No more flash of the site's chrome** at a proposal's address: the bar says "Loading…" until it knows, a return visit starts in the proposal at once, and opening a proposal says "Opening …" while the browser gets there.
- **After a save**, "Updating the preview…" and a failed render check are shown beside the switcher, and the status bar counts what is not saved to the proposal instead of saying "All changes saved".
- **Dialogs** dim the Studio instead of hiding it.
- **`theme.proposal`** in `s.settings()` sets the colour the Studio wears in a proposal (Val's violet when unset), under Settings → Studio. Like the accent, its shades are generated so text on them stays legible.
