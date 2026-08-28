# Known issues

Problems that are understood but not fixed, and the evidence behind each. One
entry per problem: what it is, what was measured, what was tried, and what the
next person should do differently.

This is not a backlog. A thing belongs here once someone has done the work of
finding out what it actually is — so the next person starts from the answer
rather than from the symptom.

## `GET /json` is one request per entry

**What it is.** `GET /json` takes a `keys` array, and the Studio's seam
(`createValSystem.fetchJsonEntry`) sends exactly one key per request.
`SourceStore.loadEntry` asks per key — deliberately, since it caches and
de-duplicates per key — so a record's visible rows each cost a request. Measured
on `/content/kb.val.ts` in `examples/next`, opening it and scrolling four times:
**46 requests for 46 keys.** They go out at once, and the browser runs about six
connections per origin, so the rest queue — and so does everything the editor
asks for afterwards. See "A request 'pending' in dev is usually queued, not slow"
in [quirks.md](./quirks.md).

**A fix exists and is tested but is NOT wired.**
`packages/ui/spa/stores/react/jsonEntriesBatch.ts` collects the reads that arrive
in one tick and sends one request per module, chunked by
`JSON_ENTRY_KEYS_PER_REQUEST`, the route's own `JSON_ENTRIES_BATCH_MAX`, and a URL
budget (same 431/413 reason `PATCH_ID_QUERY_BUDGET` exists). Wiring it into the
seam took the same 46 keys down to **6 requests**, and with the per-request cap to 4. `jsonEntriesBatch.test.ts` covers it, including that a key the response never
mentions resolves as an error rather than never settling.

**Why it is not wired.** It makes
`e2e/uncommitted-routes.spec.ts:129` ("renders in the canvas from a client
component") fail: after creating an uncommitted page, clicking Preview opens the
canvas and something closes it again, so the route bar never appears. Baseline
passes 3/3; with batching it passed 1/3 with a `setTimeout` flush, 0/3 with
`queueMicrotask`, and 1/4 with the per-request cap and chunks issued in parallel.
So it is **not** the added latency — batching in any form does it.

**Where to look next.** The prime suspect is this effect in `Shell.tsx`:

```tsx
useEffect(() => {
  if (isLoading) return;
  if (selection?.kind === "page") return;
  setIsCanvasOpen(false);
  setCanvasView("normal");
}, [isLoading, selection?.kind]);
```

It closes the canvas whenever loading settles on a selection that is not a page,
and batching changes both when `isLoading` settles and the ORDER entry reads
resolve in. Unbatched, a sibling key that resolves resolves immediately while a
missing one errors later; batched, they resolve together. The newly created page
is `missing` from the routes module (it exists only as a patch, and the Studio
reads with `apply_patches: false`), so this test is exactly the case where that
ordering differs:

```
GET /json keys=["/blogs/uncommitted"]
  -> {"path":"/app/blogs/[blog]/page.val.ts","entries":[],"missing":["/blogs/uncommitted"],"errors":[],"total":36}
```

The honest reading is that the effect has a latent race and the batching exposes
it. Fix the race first, with a test that pins it at the `Shell` level, and only
then wire the seam — the seam change is measured and ready.

## An array of OBJECTS is still diffed by index

`s.array(s.string() | s.number() | s.boolean())` is diffed by content — see
`utils/listDiff.ts` and `PrimitiveListDiff.tsx` — so a reorder reads as a
reorder and an insertion as one line. `s.array(s.object(...))` is not: it keeps
the per-index rows, which for a list is wrong in the two ways that module's
header describes. Inserting an item shifts every later index, so one insertion
reads as a cascade of changes, and each row's "before" — read from the base
source at the row's own index — names a different element than its "after".

The line is there because content matching needs two things that primitives have
and objects do not:

**Item identity.** Deep equality finds an item that moved unchanged, and nothing
else: an item that moved AND was edited matches nothing, so it reads as one
deletion plus one addition — which is what happens today anyway, but the diff
would now be claiming to know better. A schema-level notion of which field
identifies an item (the way `s.record` has a key) would fix it properly. Nothing
in `SerializedSchema` carries that today.

**A line that fits on a line.** A primitive renders as itself. An object has to
be summarised to one row before "moved from 4" can sit beside it, and the useful
summary is schema-specific — `preview(select)` already exists for exactly this
kind of question and would be the thing to reach for.

Neither is hard, and both are guesses until someone has a case in front of them.
Whoever does: `diffPrimitiveList` takes `(before, after)` and returns lines in
final order, so a `diffObjectList` with the same shape drops into
`PrimitiveListDiff` without touching the rendering.

## `ValOpsFS.readPatches` reads the whole chain to answer for one patch

`fetchPatches({ patchIds: [X] })` calls `readPatches()` with no filter, which
`fs.readdirSync`s the patches directory and then `readUtf8File` + `JSON.parse` +
zod-parses **every** patch, filtering to `X` only afterwards — all synchronous, on
the event loop. `readPatches` does take an `includes` parameter; this path does
not pass it, and even when passed it filters after parsing.

Measured against `examples/next` with fabricated chains, one-patch
`GET /patches?exclude_patch_ops=false&patch_id=<one>`:

| chain | request | response |
| ----- | ------- | -------- |
| 1     | 8–18ms  | 392B     |
| 50    | 8–10ms  | 393B     |
| 200   | 15–17ms | 394B     |
| 650   | 32–46ms | 394B     |

Linear in the chain, for a constant-size answer, and paid again by `getStat` and
`getParentPatchIdFromPatchIdMap`. The fix is to filter by `includes` before
reading, and to read off the event loop. Left alone because it is not what makes
a request appear to hang, and it is a change in `packages/server`, which means the
CLI's `validate` has to be run over it (see `.claude/CLAUDE.md`).
