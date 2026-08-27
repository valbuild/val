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

**A crash can only ever leave a directory the log does not name.** `appendPatch`
writes the record, then the log line. Interrupted, that leaves an unreferenced
directory: inert, and swept up by repair. The reverse order would leave the log
naming a patch that is not there, which is the state that started all this. **If
you touch the write path, keep that order.**

**A torn last line is discarded.** Appends are serialized by the lock, so an
unterminated final line can only be a write that did not finish.

**`parentRef` is a compare-and-swap token, not a place to write.** It used to be
neither — it named the directory and nothing checked it, so a client working from
a stale view could write a patch whose parent had never landed. A parent that is
not the current tail is now refused with a 409 that carries the real tail. Two
concurrent writes leave one winner and one refusal; before, the second silently
overwrote the first.

**Deleting is dropping lines from a list.** The log is flat, so removing an entry
cannot orphan the entries after it. This is why repair can run unattended, which
re-parenting a chain never safely could.

## Failure handling: report, repair, reset

In that order, and never silently.

- **Report** — every problem is described and logged, and reaches the API rather
  than shortening a list.
- **Repair** — under the lock: drop log entries whose record is missing or
  unreadable, sweep unreferenced directories, rewrite the log. Appended to
  `patches.repair.log`, because discarding someone's unpublished edits without
  saying so anywhere durable is how you get a person certain they saved something
  and no way to tell them what happened to it.
- **Reset** — only if repair does not settle it. `.val/patches` is **renamed** to
  `.val/patches-corrupt-<timestamp>`, never deleted.

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

A store written before this layout — a `head` directory, or records with
`parentRef` — is **refused, not converted**. Rebuilding the order would mean
trusting the very links that are unreliable there, and the stores that hit this
are the ones where that has already gone wrong. Discarding all changes clears it,
so there is a way forward that is not a terminal command.

## Where to look

| what                                          | where                                                  |
| --------------------------------------------- | ------------------------------------------------------ |
| the log format, append and rewrite            | `packages/server/src/patchLog.ts`                      |
| the lock                                      | `packages/server/src/patchLock.ts`                     |
| layout, read, repair, reset, legacy detection | `packages/server/src/patchStore.ts`                    |
| the wiring, and the CAS on `parentRef`        | `packages/server/src/ValOpsFS.ts`                      |
| the invariant, under injected faults          | `packages/server/src/ValOpsFS.patchStore.test.ts`      |
| the Studio side of the same failure           | `packages/ui/spa/stores/announcedNotDelivered.test.ts` |
