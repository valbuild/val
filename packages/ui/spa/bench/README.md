# Browser benchmark: the store system

```bash
node packages/ui/spa/bench/run.mjs                        # screen, 5 reps
node packages/ui/spa/bench/run.mjs --reps 15
node packages/ui/spa/bench/run.mjs --size small,large,page # diagnostic sizes
node packages/ui/spa/bench/run.mjs --json /tmp/bench.json  # keep the raw samples
```

Every run includes the worker-seam table (see below), which needs a second bundle
and a real `Worker` — both are set up by the runner, same as everything else.

No setup: the runner bundles with the esbuild binary out of the pnpm store,
launches the preinstalled Chromium, and drives it over CDP with node's built-in
`fetch` and `WebSocket`. Playwright is not needed and not used.

## The engine is gone; these are the numbers it left behind

This benchmark existed to answer one question — should `ValSyncEngine` be
replaced — and the answer was yes. The engine is deleted, so there is no longer a
second driver to take a ratio against, and what the runner prints now is a
**baseline**: absolute numbers for the system that shipped, which is what catches
a regression.

The engine's last measured numbers are recorded here, because a baseline with no
history is a number nobody can judge. Chromium 141, 4 cores, `screen`, 11 reps,
median of 11 with the first discarded:

| scenario         | engine  | stores      | ratio | engine `select` | stores `select` |
| ---------------- | ------- | ----------- | ----: | --------------- | --------------- |
| `intake`         | 51.7 ms | **6.20 ms** |  8.3x | 0               | 0               |
| `mount`          | 10.3 ms | **0.30 ms** | 34.3x | 0               | 0               |
| `keystroke`      | 10.6 ms | **0.40 ms** | 26.5x | 0               | 0               |
| `keystroke-list` | 10.3 ms | **0.30 ms** | 34.3x | 60              | 60              |
| `burst-40`       | 13.9 ms | **1.30 ms** | 10.7x | 0               | 0               |
| `list-view`      | 11.8 ms | **2.50 ms** |  4.7x | 1200            | 1200            |
| `nested-row`     | 12.6 ms | **0.60 ms** | 21.0x | **650**         | **2**           |

`nested-row` is the one to read twice. It is the `handboka` worst case — one
section of one chapter, with `select` at two nested array levels — and the
duration is not the interesting column. The engine ran 650 `select` closures to
put one row on screen because its finest render is per module; the stores ran 2,
because a render is scoped to the paths that have listeners on them. The 21x is a
consequence of that, not a separate fact.

Two more, from the same run:

- **React re-renders per keystroke, at 16 mounted fields: engine 16, stores 0.**
  The engine's finest source subscription was per MODULE, so every mounted field
  in the edited module re-rendered on every character. Per-path notification
  wakes the fields whose own value moved — and per-instance suppression leaves
  the field being typed into alone, which is why the answer is 0 rather than 1.
- **Retained heap after two forced collections: 3717 KB against 2263 KB** (1.6x),
  or 232 KB vs 141 KB per mounted field. The engine deep-cloned a whole module on
  every source read; the stores hand out the object they own.

Nothing here says the store system is fast in absolute terms — it says it costs a
fraction of what the thing it replaced cost, on the same hardware, measuring the
same unit. Absolute numbers on real hardware will differ.

## Why this exists

Every cost claim in [`../stores/architecture.md`](../stores/architecture.md) is
an invocation **count** asserted in node. Counts were chosen because they are
exactly reproducible where a duration is not — but a count cannot tell you
whether the thing it counted takes 20 microseconds or 20 milliseconds, and it
cannot see main-thread blocking, which is what makes typing feel bad.
`openquestions.md` lists this as the **go/no-go**: if the earlier fixes in #476
already bought most of the available win, the right call is to keep the engine,
and no amount of green tests changes that.

## The fairness contract

The long version is at the top of [`drivers.ts`](./drivers.ts). The short
version, because it is the part that decides whether any number here means
anything:

The two systems are shaped differently on purpose, so "call the equivalent
method" does not exist. `ValSyncEngine.getSourceSnapshot(module)` is per module
and deep-clones; `SourceStore.get(path, revision)` is per path and clones
nothing. The engine is **eager** — `addPatch` applies the patch and kicks
validation, renders and patch sets before returning. The stores are **lazy** — a
patch marks, and the following read computes.

So timing `addPatch` against `createPatch` would be rigged for the stores: it
would time the eager system doing all the work and the lazy system doing none of
it. Timing only the reads would rig it the other way.

**The unit of measurement is therefore a field becoming ready.** Every scenario
runs from "the keystroke is issued" to "every mounted field has in hand the three
things it needs to paint: the source at its path, the validation errors for its
module, and the render at its path." Neither system can win that by deferring
work past the stopwatch.

Three supporting rules:

- **Both systems get their modules locally**, from the same generated
  `ValModule[]`. The engine's `setValModules` is its local-modules path and is
  the closest thing it has to `HostStore.receive`. Neither driver is allowed a
  network call — the injected client throws, so a scenario that takes a network
  path fails loudly instead of reporting a suspiciously fast 0ms.
- **`select` invocations are counted next to every duration.** A system can be
  faster because it is better or because it did less. Only the count separates
  those, and "did less" is legitimate only if the field still got what it needed
  — which the rule above enforces.
- **`fieldsReady` is printed.** With two drivers, a disagreement meant the row
  was not a comparison and the runner exited non-zero. With one it is still the
  guard against the classic benchmark lie — fast because it silently did nothing
  — and a scenario whose `fieldsReady` drops to 0 is reporting the cost of doing
  nothing, however good the millisecond column looks.

### The mounted-field count decides the answer

Five sizes. Picking the wrong one produced a wrong answer three times:

| size         | modules | fields mounted        | what it is for               |
| ------------ | ------- | --------------------- | ---------------------------- |
| **`screen`** | 141     | **16, in one module** | **MEASURED. Quote this one** |
| `realistic`  | 141     | 60, all of one page   | the pessimistic screen       |
| `small`      | 14      | 23                    | a quick check                |
| `large`      | 141     | 260, 2 per module     | a site-wide sample           |
| `page`       | 22      | 1202, 60 per module   | finding scaling defects      |

Two of the costs measured here are **linear in mounted fields** — listener
registration and the per-path read cache — so an inflated count overstates them.
Every claim of a LOSS in this benchmark's history came from that, and the fix was
to stop guessing:

`examples/next` was run for real — Next dev server plus the UI's Vite dev server
— and the Studio driven over CDP to count what a screen mounts.
`/~/app/page.val.ts`, the richest real module, renders a content area of 63
elements: **~15 field rows**. The 24-chapter handbook list renders ~24 rows. The
Studio shows a compact PREVIEW row per field, not a form full of inputs.

So `screen` is 16 mounted fields, and at that count there is no loss anywhere.

Keep the inflated sizes: mounting far more than is real is how a scaling defect
surfaces — the O(all registered paths) listener scan was found on `page` and
nowhere else. They are instruments, not descriptions.

The inflated sizes are kept because mounting far more than is real is how a
scaling defect surfaces: the O(all registered paths) listener scan was found on
`page` and nowhere else. They are diagnostic instruments, not descriptions.

The project is generated because the claim under test is about how cost scales,
and a single real project gives one point. It includes the case that actually
hurts: `select` at two nested array levels, the `handboka` shape named throughout
the architecture notes. `examples/next` now carries the same shape for real —
a 344 KB generated handbook (`cd examples/next && pnpm handbook generate`) with
nested lists, richtext, images, routes and `keyOf` references, in a project that
really builds and really validates.

## The worker seam

The other tables compare two systems. This one compares two **placements** of the
same three stores: `SearchStore`, `PatchSetStore` and `ReferenceStore`, in-process
against a real `Worker` (`workerRealmEntry.ts`, bundled separately and served at
`/worker.js`, wired in through `SystemOptions.workerRealm`).

A worker buys exactly one thing — the compute stops occupying the main thread —
and pays for it with a structured clone of the arguments (**synchronously, on the
main thread**, inside `postMessage`), a clone of the result, and a task hop each
way. So two columns, and the decision is the pair:

- **`total`** is wall clock. A worker should always LOSE it: same work, plus two
  clones, plus scheduling.
- **`delay`** is how long a macrotask queued behind the call had to wait before it
  could run — the latency a keystroke arriving mid-operation would suffer. This is
  the only thing a worker can improve, and it is what typing feel is made of.

`!` means the main thread never yielded once during the region. Every in-process
row is marked, which is a fact about the current design that no invocation count
could have shown.

Measured at `screen`, 11 reps:

| op                  | payload | in-proc delay | worker delay | total | verdict         |
| ------------------- | ------- | ------------- | ------------ | ----: | --------------- |
| `search:index`      | 1407 KB | **124 ms** !  | 9.1 ms       |  1.2x | **move it**     |
| `search:reindex`    | 11 KB   | **43.7 ms** ! | 0.2 ms       | 0.7x? | **move it**     |
| `search:query`      | 0 B     | 0.8 ms !      | 0.2 ms       |  4.6x | nothing to move |
| `patchSets`         | 9 KB    | 0.1 ms !      | 0.3 ms       |     - | nothing to move |
| `patchSets:append`  | 9 KB    | 0.1 ms !      | 0.2 ms       |     - | nothing to move |
| `patchSets:current` | 0 B     | 0.1 ms !      | 0.1 ms       |    -? | nothing to move |
| `refs:rescan`       | 1407 KB | 2.3 ms !      | **9.5 ms**   | 12.4x | **no**          |
| `refs:find`         | 0 B     | 0.1 ms !      | 0.2 ms       |    -? | nothing to move |
| `refs:at`           | 0 B     | 0.1 ms !      | 0.1 ms       |    -? | nothing to move |

**Both halves of the standing hypothesis were wrong.** `openquestions.md` said
the patch-set store was the likeliest win (a whole-chain rebuild) and the
reference store the likeliest loss (small, frequent queries). Search is the only
one worth moving, and references loses in `rescan` — the whole-project gather —
rather than in the small frequent queries the prediction was about, which are
0.1 ms either way with nothing there to win or lose.

The rule underneath: **a worker is paid by the size of the compute and charged by
the size of the arguments.** Search wins because indexing 141 modules is genuinely
expensive relative to what it is handed. Reference rescan loses because it hands
the whole project over to do 2 ms of work.

### The patch-set row was measuring a defect, and it is fixed

An earlier revision of this table read **1120 KB, 198x total, 76x delay** for
`patchSets` — the worst row here by two orders of magnitude — and the conclusion
drawn from it was "never move patch sets to a worker, it makes main-thread
blocking 76x worse". That conclusion was wrong, because the number was not about
the seam.

`PatchSetStore.getPatchSets` rebuilt the grouping from the WHOLE chain whenever
the chain version had moved, and the caller passed `schemaStore.all()` — every
serialized schema in the project — to group patches that usually touch one module.
So one keystroke made the next grouping read re-insert every patch in the session
and clone 1.1 MB to do it. `PatchSets` had supported incremental insert all along
(`insertedPatches`, `isInserted`); nothing was using it.

It is now incremental, with the append-or-rebuild decision on the HOST
(`PatchSetChain`) for the same reason `StaleModules` is there: the host is the side
that saw the change. The payload is the delta and nothing else — and nothing at all
when there is no delta. Measured: **1120 KB → 9 KB**, worker total **19.8 ms →
0.4–1.7 ms**, delay **7.6 ms → 0.2–0.3 ms**.

So the verdict for patch sets is now "nothing to move" rather than "must not
move": at 0.1 ms in-process there is no blocking left to take off the main thread.
That is a different and much less alarming statement, and the lesson is the part
worth keeping — **a bad seam number can be a defect on either side of the seam**,
and this one was on ours.

### What the remaining big payload does mean

`refs:rescan`'s 1407 KB is real, and it is a first pass over every loaded module —
genuinely whole-project work. Its incremental case is already the `refs:find` row
at 0 B. So the tension named above (a stateful seam would be needed to shrink it)
applies to the FIRST scan only, and a first scan has to see everything by
definition.

### An adjacent finding: 43 ms to reindex one module

`search:reindex` is one module edited, then one query — and it costs 43 ms of
main thread that never yields. The query alone is 0.6 ms, so essentially all of it
is reindexing a single module.

The cause is `removeModule`: `indexModule` is remove-then-add, and FlexSearch's
`index.remove(id)` scans the whole index per document when the index is built
without `fastupdate`. Setting `fastupdate: true` was measured and cuts it
**43.3 ms → 1.70 ms** (25x) — and is NOT a usable fix: `systemFlow.test.ts` fails
with it, because with `fastupdate` FlexSearch's `index.search` returns `undefined`
rather than `[]` once documents have been removed. So the magnitude and the cause
are established, the obvious one-liner is ruled out with evidence, and the fix
belongs to whoever picks up the search index.

Note it also flips that row's verdict: at 1.7 ms there would be nothing left to
move to a worker.

## What is deliberately not measured

- **`PUT /patches`.** Wired (`PatchSync`), but deliberately not configured here:
  the driver passes no `savePatches`, so the stores record edits and send
  nothing. That keeps these numbers about the read and apply paths. The write
  path is covered against a real server by `e2e/studio.spec.ts`, which is the
  right place for it — a benchmark that included a network round trip would be
  measuring the network.
- **A real field component.** There IS a React harness (`reactHarness.tsx`), and
  it produced the clearest result in the exercise: at `screen`, one keystroke
  re-rendered **16 components in the engine and 0 in the stores**, because the
  engine's finest source subscription was per module. But its field is a
  `<span>`, so its millisecond column is a floor — a real Val field is a
  rich-text editor. Read the render COUNT, not the time.

  Mount renders were 32 against the engine's 16 until the harness stopped kicking
  an async `get` from `subscribe` and started peeking synchronously from
  `getSnapshot`. That was a real finding about the stores, not about the harness:
  see `openquestions.md` item 1. They are 16 each now.

- **HTTP.** Same server for both; it would only add noise.
- **The `examples/next` modules themselves.** The handbook fixture there has the
  right shape, but the benchmark still generates its own modules rather than
  importing that app's.

## Reading the output

`ratio` compared two drivers and is empty now that there is one. It is kept in
the output because the worker-seam table still prints one, and there the
convention matters: a `?` after a ratio means the two sample ranges **overlap**,
so the ratio is not established by that run. An unmarked 1.4x on overlapping
ranges is the single most misleading thing a benchmark can print. Increase
`--reps` before believing a marked row either way.

`blocking` is the part that runs synchronously inside the keydown handler. It
matters separately from total time: total time can be paid after the character
appears, blocking time cannot.

Runs on a 4-core headless container. Absolute numbers on real hardware will
differ; the ratios and the shape of the scaling are the transferable part.
