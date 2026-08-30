---
"@valbuild/ui": patch
---

Give the phone's preview one switch, with three modes and a way out

The phone had two two-state switches sitting on one row, and each of them
changed what the other one meant. "Editor / Canvas" said which pane you were
looking at; "Normal / Fields" said what the editor pane held, and appeared only
while you were on that pane. So "Editor" did not mean anything about the editor
— it meant "not the page" — and where a press left you depended on where you
already were. Underneath, the panes were a horizontal snap scroller, which meant
which mode you were in was a scroll offset that anything touching the layout
could change.

It is now one control with the three states there actually are — **Normal**, the
module editor; **Fields**, the page's own fields; **Preview**, the page — and an
X beside it that leaves. Each option names a destination, and every press lands
in the same place regardless of where it started from.

**Preview goes there and back.** On a phone the canvas is not a region beside the
editor that is either present or absent, so the Preview button no longer toggles
it in and out of existence: the first press opens the page and takes you to it,
and each press after that swaps between the page and the fields you are editing.
Edit, look, edit again, without the page reloading in between. Leaving is the X,
and only the X, because "take me back to the fields" and "I am done with this
page" are not the same intention and used to be the same button.

**The panes are a transform now, not a scroll offset.** A snap container
re-snaps to the area it last considered current whenever its contents change,
and the fields column changes constantly as each field's schema resolves — so a
mode you had just chosen could be quietly undone a frame later, and reading the
offset back to find the mode then agreed with the undo. Three refs and two
timers existed to paper over that, and all of it came down to owning a number
the browser also owned. The track is moved with `transform` and the wrapper is
`overflow: clip` rather than `hidden`: a hidden box whose content overflows is
still a scroll port with no scrollbar, so a `scrollIntoView` inside the framed
page — which walks out of a same-origin frame and into the embedder — could
still leave the workspace showing half the editor and half the page. A clipped
box is not a scroll port at all, so there is no offset for any of that to write
to.

**Leaving really leaves.** The canvas used to be built on first open and never
torn down, so a closed one went on running the customer's site in a hidden
frame. It is now mounted exactly while it is open, and what was picked and
attached on the page goes with it. Switching modes is not leaving, and does not
cost a page load.

That last change turned a silently wrong answer into a visible one: **the canvas
no longer closes itself out from under a page that has not said what is on it
yet.** Whether it stays open is decided by whether the editor is on content the
page reported, and a page that has reported nothing has not said the editor is
elsewhere — it has said nothing at all, which is every page for its first second
and every page whose preview mode is off. Where the report is empty, what decides
is now what the navigation managed to say: a route it resolved to a gallery or a
data module is somebody going somewhere else and still closes it, but a route it
could not resolve at all leaves nothing here knowing anything, and the canvas
stays.

That second case is the whole uncommitted-route flow rather than a window: a page
created from a patch has no row in the navigation, because routes are read with
`apply_patches: false`, and its frame is still fetching when the navigation data
settles. The canvas shut a moment after being opened. It looked survivable only
because the closed canvas left its frame mounted and merely hidden, so the page
went on loading out of sight.

Also: a pick on the page always ends on the fields, rather than only when the
pane happened to be somewhere else; the switches have room to breathe above the
content, instead of a two-pixel gap; and the option that used to read "Canvas"
reads "Preview", which is what it is called everywhere else.
