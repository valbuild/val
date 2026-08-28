---
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
