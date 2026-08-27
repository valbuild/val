---
"@valbuild/core": minor
"@valbuild/ui": minor
"@valbuild/shared": minor
"@valbuild/next": minor
"@valbuild/server": patch
---

A new Studio: a floating shell, a canvas beside the editor, and a compare view that tells the truth

The Studio is rebuilt around a floating shell — a rail, panels that come and go, and
a content column that no longer shares its scroll container with a fixed-height list.
The editor sits beside a **canvas**: the real site in an iframe, deep-linked
(`?canvas-at=`), live-updated as patches apply, and able to pick a field by clicking
it on the page. `@valbuild/shared` exports `valCanvasProtocol` for the messages that
travel between them, and `@valbuild/core` exports `renderScope` / `RenderScope`, so a
render can be scoped to the paths actually on screen instead of the whole module.

### The compare view

**Nothing in it is editable any more.** Typing into the "After" side used to work,
which reads as a feature and is not one: the value under the cursor is the result of a
chain of patch sets, each with its own author and its own Discard, so an edit made
there belongs to none of them and lands as a further patch on top — while the row it
was typed into goes on describing the change it used to describe. Discarding, which is
what the view is for, is unaffected.

**A `.jsonValues()` entry now shows what it was.** The base realm was substituting the
PATCHED entry content into the base source, so both sides of the compare showed the
same value, byte for byte, for `.jsonValues()` modules only. Base entry content is now
kept apart, which also fixes two latent bugs of the same family: a published edit
inside an entry no longer keeps showing as outstanding, and discarding a patch that
touched an entry now actually takes the edit out.

**A list of primitives is diffed as a list.** `s.array(s.string() | s.number() |
s.boolean())` was rendered one row per touched index, and array paths are positional —
so inserting an item shifted every later index, one insertion read as a cascade of
changes, and each row's "before", read from the base source at that index, named a
different element than its "after". Matching by content instead: a reorder is one line
saying where the item came from, an insertion is one line, a deletion says where it
was. Arrays of objects keep the per-index rendering.

### Media and fields

Image and file fields are restyled with a "Choose asset" flow, the focal point is
folded away by default and the thumbnail opens the image at a size worth looking at.
Previews never scale above an asset's real size. A gallery-backed image field no longer
warns about metadata it is deliberately not holding, and its focal point toggle — a
dead control, because such a field has no `metadata` object to add to — works.

### Loading, saving and errors

The pending-changes gate holds writes rather than the whole editor, so navigation keeps
working while patches arrive; it can be dismissed, and past a minute it reports what
did not turn up instead of spinning forever. The save button carries an icon per state
at a fixed size, and a blocked one takes you to the errors. A save conflict can now
recover (`resyncChain` was never wired), an unparseable save response is no longer
retried silently as a network error, and a thumbnail that 404s retries before giving
up.

`@valbuild/next` gains a bounded safety refresh, because a `router.refresh()` fired on
an edit races the write that persists it.
