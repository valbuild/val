---
"@valbuild/ui": patch
"@valbuild/next": patch
---

Make the field update loop cost what it is supposed to cost again

The stores are demand-driven and per path, and they still are. What had
accumulated on top of them was a set of subscriptions that are not — every one
of them mounted once per field, so each turned a single edit back into
O(project) work, which is the cost the whole architecture exists to remove,
reintroduced one layer up. Along the way, three things that looked like "the
editor is slow" turned out to be specific faults.

**A rich text field could render blank and stay blank.** Two independent
things had to be true for it, and each hid the other. The field passed the
editor neither `value` nor `defaultValue`, so the ProseMirror view was always
built empty and the content arrived afterwards through an imperative `reset()`
in an effect — which made that effect load-bearing for the first paint, and
its dependencies are the SOURCE. Meanwhile the view is destroyed and rebuilt
when `readOnly` or a toolbar feature changes, and a rebuild re-parsed a
`defaultValue` that was not there. So a rebuild emptied the field and nothing
refilled it: the consumer only re-seeds when source moves, and source had not
moved. The trigger in practice was not anything a user did — `useValPortal`
is filled on commit, so the portal container arrives as `null` and then as an
element on the very next render.

Fixed three times over, because each closes it alone and all three are worth
having: the field seeds the editor with its source, the editor carries its
live document across a rebuild, and the portal container is read at use time
so it is not a dependency of the view at all. `ValPortalProvider` holds the
node in state rather than handing out a ref read during render, so its arrival
is an update React knows about instead of one delivered to whichever consumer
happens to re-render next.

**`/stat` was a project-wide render pulse on a timer.** It long polls in `fs`
mode on a watcher over `.val/patches`, so it answers on every write and again
every twenty seconds — and the answer is usually the chain the client already
holds. `patch:chain` went out regardless, which rebuilds the file-patch map for
every media field, re-renders every `useChainVersion` reader, and reschedules
the pending-module validation pass. The bump now sits where the mutation is.
The first stat and a reorder of the same ids are still announced, because
`chainSettled()` gates the whole editor on the first one and `/stat` is the
authority on order.

**One broken `.jsonValues()` entry was a fetch every 200ms.** `peek` draws a
deliberate line between "ask for it" and "stop asking and say so", and the bulk
prefetch did not observe it: a failure is recorded apart from the loaded
content, so a `has(key)` test called the entry wanted forever. The canvas relay
calls that path on every source change. It now skips a recorded failure — and
forgets one whenever something contradicts it, so an entry that failed during a
dev-server restart is not broken for the life of the tab.

**The canvas asked the page to re-render work it had already done.** The
`router.refresh()` loop was armed by the ARRIVAL of a source update rather than
by the value moving, and the editor re-sends everything it holds every time the
page becomes a new document — which with auto-save on is once per pause in
typing, since publishing rewrites the `.val.ts` files and `next dev` reloads.
`ValExternalStore.update` reports whether it changed anything, and the refresh
is armed on that. Separately, the fast `/draft/stat` poll that runs while
preview mode is being toggled had no deadline: the only thing that ended it was
a message from a frame that may never load, so a failed handshake left the page
asking ten times a second, against a browser that allows six connections per
origin. It gives up after ten seconds and says so.

**And the per-field subscriptions themselves.** `Field` read the write queue,
so every save round trip re-rendered the whole mounted tree twice and disabled
every checkbox in the Studio while it was in flight. `usePendingPatches` walked
the whole chain per field on every chain movement; it reads a shared per-path
index now, reference-stable so only the affected field wakes. The rich text and
route fields read every module's source through `useRoutesOf` on every
keystroke anywhere; that walk is shared and its answer is stable, so a change
that does not move the routes — which is almost all of them — re-renders
nothing.

Two seams so this is legible rather than merely correct. `PatchIntake` makes
the three ways a patch reaches source three named variants of one union, with
one place deciding who each wakes. `useValField` mints a field's identity and
never hands it out — which found the rule already broken everywhere, since an
editable field also resolves its schema at its path and that hook registered a
source listener under an id of its own, waking every field on its own
keystroke. `perFieldSubscriptions.test.ts` now covers every field file against
six hooks, with a reason required for each exception.
