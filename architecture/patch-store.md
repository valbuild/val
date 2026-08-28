# The local-dev patch store

Where unpublished edits live in `fs` mode, and the failure that decided its
shape. `ValOpsHttp` (remote mode) is a different thing entirely and none of this
applies to it.

## The layout

```
.val/patches.lock             held while the store is being changed
.val/patches/
    patches.log               the ORDER, and the only place it lives
    patches.repair.log        what repair has done, and when
    <patchId>/patch.json      one self-contained record per patch
    <patchId>/base.json       written when the patch is published
    <patchId>/files/…         binary payloads for this patch's file ops
.val/uploads/
    <patchId>/files/…         uploaded bytes, until the patch record exists
```

Two rules carry the whole design:

1. **A directory is named after the patch it holds**, and the record inside
   references nothing outside itself. There is no `parentRef` in `patch.json`.
2. **`patches.log` is the chain.** Position in the file is the order. Entry _i_'s
   parent is entry _i−1_; the first patch's parent is `head`.

`parentRef` still exists on the wire, because the API and `ValOpsHttp` are built
on it. It is derived on read and checked on write — see below.

## Why, in one incident

The old store put the order in the patches. Every record carried a `parentRef`,
and the directory a record lived in was named after **its parent**, so reading
the chain meant walking links from a directory called `head`.

A store with 410 pending changes lost exactly one record. The chain walk in
`createPatchChain` had no error path — it just stopped when it ran out of links —
so:

- `getStat` listed the directories on disk and announced **410**.
- `fetchPatches` walked the links and delivered **359**.
- The 51 patches written after the lost one were announced, never delivered, and
  never errored.

The Studio has no way to read that. `PatchStore.fetching` is what stops a second
request for an id already in flight, and ids left it only on a record or an
error; those 51 came back as neither, so they stayed "in flight" forever. Never
requested again, never failed, chain never settled — "Loading unpublished
changes…" for as long as the tab was open.

Three separate defects, one root: **the order was stored in the same links that
could break.**

## The properties that replaced it

**One read, one answer.** `getStat` and `fetchPatches` both come out of a single
`readStore()` call in `ValOpsFS`. Announcing from one source and delivering from
another is the bug; deriving both from one array is the fix. If you add a third
caller, take it from there too.

**And one answer per MOMENT.** `/stat` long polls: it reads, finds nothing
changed, and waits up to `statPollingInterval` for a file to move. So "one read"
is not enough on its own — the read has to be the one the answer is sent with.
`getStat` reads the store again after the wait — the store only, because the
shas and schemas come from `initSources`, which is memoised for the lifetime of
the `ValOpsFS` instance and never invalidated. The reason is `/save`:

- The write that ends most waits is the studio's own publish, which in `fs` mode
  commits the patches and **deletes** them.
- Answering with the list read before it names patches that stopped existing a
  polling interval ago.
- The studio then puts those ids back in its chain and fetches them from a server
  that correctly no longer has them — "unpublished changes could not be loaded",
  for changes that were just published. With auto-save on, that is every pause in
  typing.

`request-again` and `no-change` differ in why the wait ended, not in how current
the answer has to be, so both re-read. **If you add a branch that returns after
the wait, read again there too.**

The studio does not rely on this. A snapshot protocol cannot promise its list was
not overtaken, so `PatchStore` treats an announcement of a patch it has already
published as stale (`publishedIds`), and gives an announced-but-undelivered id one
more stat before reporting it (`notDeliveredOnce`). The server fix removes the
routine case; the client fix is what makes the rest correct.

**The base moves on a publish now.** `/save` hands the sources it just wrote to
`ValOps.adoptCommittedSources`, which adopts them and re-folds the SHAs — because
re-reading them cannot work: a module's content is read by awaiting its `def`,
the app's own `import()`, which resolves from the module registry rather than the
file that was just rewritten. So in `fs` mode `baseSha` changes within a server's
lifetime for the first time, which is what `reconcileVanished` needs to tell a
patch that was PUBLISHED from one that was discarded. `schemaSha` does not move —
the fold leaves it alone when only sources change, so nothing refetches `/schema`.

What that does NOT cover is `.jsonValues()` entry content: it is not in the
source, which holds only markers. See `architecture/quirks.md`.

**A crash can only ever leave a directory the log does not name.** `appendPatch`
writes the record, then the log line. Interrupted, that leaves an unreferenced
directory: inert, and swept up by repair. The reverse order would leave the log
naming a patch that is not there, which is the state that started all this. **If
you touch the write path, keep that order.**

**Uploaded bytes are not in the store until they belong to something.** A patch
carrying a file is written in TWO requests, bytes first: the record's `file` op
holds only a sha, so a record written before its bytes would point at nothing.
Uploading straight into `<patchId>/files/` left the directory holding files and
no `patch.json` for a whole round trip — neither of the two shapes above — so
`readPatchStore` read it as a patch whose contents were lost and repair removed
it, bytes and all, telling the person editing their work had been thrown away.

That window was not rare and not passive: writing into `.val/patches` is exactly
what breaks `getStat`'s long poll, so **the upload summoned the read that
destroyed it**. Replacing an image worked only when the two requests happened to
land close enough together.

So uploads go to `.val/uploads/<patchId>/` — a sibling, so nothing reading the
store lists it and moving into place is a rename — and `appendPatch` moves them
in. **Record, then bytes, then log line**, all under the lock:

- the record first, so a patch directory never exists without one, which is what
  makes "files but no `patch.json`" a state this store cannot produce;
- the log line last, for the reason above;
- under the lock, so repair — which re-reads under it — never observes the
  halfway state.

Both readers of those bytes accept either location (`wherePatchFileIs`), because
the studio asks for the new image before the patch referencing it is written. A
staging directory whose `PUT` never arrived is swept after a day; that TTL only
governs garbage collection **outside** the store, where being wrong costs disk
space rather than someone's upload.

**A torn last line is discarded.** Appends are serialized by the lock, so an
unterminated final line can only be a write that did not finish.

**`parentRef` is ignored in `fs` mode.** It used to be the directory name, which
is how a client working from a stale view could write a patch whose parent had
never landed and strand everything behind it. With the order in one append-only
list the server decides where a patch goes — last — so there is no parent to name
and nothing that can point at nothing. Two concurrent writes are two lines in a
list; before, the second silently overwrote the first.

The parameter stays on `ValOps` because `ValOpsHttp` genuinely needs it: the
content api runs its own chain and is told the parent. In `fs` mode a stale
parent is not an error to refuse, it is a fact with no consequences.

What that gives up is early detection of a patch computed against a different
state — two tabs editing the same array can produce an op that no longer fits.
That is caught where it shows, applying the patch, and handled by dropping it and
saying so, rather than by refusing writes up front and making every interleaved
edit a round trip.

**Deleting is dropping lines from a list.** The log is flat, so removing an entry
cannot orphan the entries after it. This is why repair can run unattended, which
re-parenting a chain never safely could.

## Failure handling: report, repair, reset

In that order, and never silently.

- **Report** — every problem is described and logged.
- **Repair** — under the lock: remove directories that cannot be used as patches,
  sweep unreferenced ones, rewrite the log. Appended to `patches.repair.log`,
  because discarding someone's unpublished edits without saying so anywhere
  durable is how you get a person certain they saved something and no way to tell
  them what happened to it.
- **Reset** — only if repair does not settle it. `.val/patches` is **renamed** to
  `.val/patches-corrupt-<timestamp>`, never deleted.

**The person editing is told**, on `/stat`. Not on `GET /patches`: the case worth
reporting is a repair that removed everything, and then there is nothing left to
fetch, so a notice riding on the fetch is never collected. The server drains the
notice when it hands it over, so it arrives exactly once — a permanent flag would
put a toast on the screen forever.

Directories are told apart by whether they hold a usable record. One that does
not is an **unreadable patch**: work is gone, and it is reported. One that holds a
perfectly good record the log does not name is a **crash leftover** — a record
written before its log line — which nothing ever read, so nothing is lost and
nobody is told. There is no third case: uploaded bytes live outside the store
until the record exists, so a record-less directory in `.val/patches` really is
lost work. See the write-path rule above.

Repair only runs when something is wrong, so the healthy path — every stat poll —
never touches the lock.

## The lock

`.val/patches.lock`, plain `key: value` text, deliberately **outside**
`.val/patches/` so delete-all and reset can rename that directory while holding
it.

- Acquired with `fs.openSync(path, "wx")` — `O_CREAT|O_EXCL`, atomic.
- **Timed.** A killed dev server must not wedge the store forever, so a lock
  nobody renews expires. Long operations call `renew()`.
- A stale lock is removed only after being read **twice, unchanged**. Without
  that, two processes both deciding a lock is stale means the loser deletes the
  winner's brand-new lock.
- Reads (`getStat`, `fetchPatches`) are lock-free.

Use `withPatchLock`, not `acquirePatchLock` directly: a `release()` a throw can
skip is how a store ends up locked by a process that has long since moved on.

## Old stores

There is **no detection for the old layout**, and that is deliberate. It named a
directory after the record's _parent_, so "the directory does not hold the patch
it is named after" already catches it — and catches a directory renamed by hand,
and a half-finished move. One rule instead of a special case that has to be kept
in step with a format nobody supports.

So an old store is read as a pile of unusable directories and removed like any
other, and the Studio loads. There is nothing to recover: the order lived in the
links that are exactly what goes wrong. The person editing is told how many
changes went, and why.

## Where to look

| what                                                | where                                                  |
| --------------------------------------------------- | ------------------------------------------------------ |
| the log format, append and rewrite                  | `packages/server/src/patchLog.ts`                      |
| the lock                                            | `packages/server/src/patchLock.ts`                     |
| layout, read, repair, reset, legacy detection       | `packages/server/src/patchStore.ts`                    |
| the wiring: read, repair, reset, the removal notice | `packages/server/src/ValOpsFS.ts`                      |
| the invariant, under injected faults                | `packages/server/src/ValOpsFS.patchStore.test.ts`      |
| the Studio side of the same failure                 | `packages/ui/spa/stores/announcedNotDelivered.test.ts` |
