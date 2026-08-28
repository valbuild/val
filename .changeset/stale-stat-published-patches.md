---
"@valbuild/core": patch
"@valbuild/server": patch
"@valbuild/ui": patch
---

Stop auto-save reporting published changes as changes that could not be loaded

With auto-save on, the studio would show "N unpublished changes could not be
loaded — the server listed them but did not send them" for changes that had just
been published successfully.

`/stat` long polls in `fs` mode: it reads the patch store, finds nothing changed,
and waits for a file to move. It then answered with the list it read when the
poll opened — and the write that ends most waits is the studio's own `/save`,
which commits the patches and deletes them. So the response named patches that
had stopped existing a polling interval earlier, the studio put those ids back in
its chain, fetched them from a server that correctly no longer had them, and got
an empty answer it reported as the server contradicting itself. Auto-save made it
routine by publishing on every pause in typing.

`getStat` now reads again before it answers, so the list describes the moment of
the response rather than the moment of the wait. The studio no longer depends on
that: it ignores an announcement of a patch it has already published, and gives
an announced-but-undelivered id one more stat before reporting it — an
announcement can be older than a delete, and only a stat issued after the delete
can tell that from a server that cannot send what it has. The report for a server
that really is announcing what it cannot deliver is unchanged, one stat later.

Also fixes two timers the long poll left running behind every stat: the
polling-interval fallback, which nothing cleared when another branch won the
race, and the module-file poller, which rescheduled itself after the cleanup had
already run.

## The canvas going stale after an auto-save

Two defects in the same area, with the same cause: publishing rewrites the
`.val.ts` files, `next dev` reloads the page on the change, and the studio was
not set up to catch that new document up.

The canvas relay carries changes, so a freshly loaded document is caught up once
with a snapshot of what the editor holds. That snapshot was keyed on the reloads
the STUDIO asked for, and a page that reloads itself announces the new document
with another `ready` carrying the same `draftMode` — nothing the effect depended
on changed, so it never re-ran. It is now keyed on the page announcing itself,
which covers both.

And the snapshot only named modules with a PENDING patch, which is the set a
publish empties. So even when it did run it had nothing to send, and then said
`sourcesSynced` — telling the page to render committed source. If that render
came from a server that had not picked up the newly written file, the canvas sat
on pre-publish content until the next keystroke put a patch back in the chain.
The snapshot now also names the modules this session published into
(`PatchStore.publishedModules()`), whose live source in the editor is the
published value.

## Committed content the server has just written

`ValOps` memoises the sources and re-reads them by awaiting each module's `def` —
the app's own `import()`, which resolves from the module registry rather than from
disk. So after `/save` rewrites a `.val.ts`, invalidating the memo would return
the pre-save content and store it as fresh; nothing replaced it until the host
rebuilt its module graph. That is what a page rendering draft content falls back
on once a publish has removed the patches, so it showed the content from before
the publish.

The save tells `ValOps` instead: `adoptCommittedSources` takes the analysis it
just committed and adopts the sources it produced. The SHA fold moved out of
`extractValModules` into `computeValModuleShas` so those SHAs can be recomputed
over sources that did not come from evaluating the modules — the entries the fold
ran over are kept, and replaying them unchanged reproduces the SHAs exactly, so
only a module whose source actually moved changes anything.

`baseSha` therefore moves on a publish in `fs` mode, for the first time within a
server's lifetime. That is a signal the studio already knows how to read:
`PatchStore.reconcileVanished` uses a moved base to tell "these patches were
published" from "these were discarded", so a second studio watching a publish
takes them out of its chain without reverting the published fields. `schemaSha`
does not move, so nothing refetches `/schema`.

Not covered: a `.jsonValues()` entry's content is not in the module source — the
source holds markers and the content sits behind the marker's own `import()`
thunk, which caches the same way. `architecture/quirks.md` records what closing
that would take.

## Replacing an image usually did not take

The bytes of a patch's file are uploaded a round trip BEFORE the patch record
that references them — the record's `file` op carries only a sha, so a record
written first would point at nothing. That leaves `.val/patches/<patchId>/`
holding `files/` and no `patch.json` until `PUT /patches` lands, which
`readPatchStore` read as a patch whose contents were lost: repair removed the
directory, took the uploaded bytes with it, and told the person editing their
unpublished change had been thrown away. The image then 404ed from
`?patch_id=...` and the replacement silently did not happen.

The window is not passive. Writing into `.val/patches` is exactly what ends
`getStat`'s long poll, so the upload summons the read that destroys it — which is
why replacing an image worked only when the two requests happened to land close
enough together.

So uploaded bytes are no longer in the store until they belong to something. They
go to `.val/uploads/<patchId>/` — a sibling of the patches directory, so nothing
reading the store lists it and moving into place is a rename — and `appendPatch`
moves them in: record, then bytes, then log line, all under the lock. The record
first is what makes "files but no `patch.json`" a state the store cannot produce;
the log line last keeps the existing crash property; and the lock means repair,
which re-reads under it, never sees the halfway state.

Both readers of a patch's bytes accept either location, because the studio asks
for the new image before the patch referencing it has been written. A staging
directory whose `PUT` never arrived is swept after a day — a TTL that only
governs garbage collection outside the store, where being wrong costs disk space
rather than someone's upload.
