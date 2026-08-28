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
