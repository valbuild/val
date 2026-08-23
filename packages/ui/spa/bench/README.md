# Browser benchmark: stores vs `ValSyncEngine`

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
- **`fieldsReady` is printed.** If the two drivers disagree on it, the row is not
  a comparison and the runner exits non-zero. That is the guard against the
  classic benchmark lie: fast because it silently did nothing.

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

Measured at `screen`, 15 reps:

| op               | payload | in-proc delay | worker delay |  total | verdict                      |
| ---------------- | ------- | ------------- | ------------ | -----: | ---------------------------- |
| `search:index`   | 1407 KB | **112 ms** !  | 8.9 ms       |   1.3x | **move it**                  |
| `search:reindex` | 11 KB   | **43 ms** !   | 0.2 ms       |  0.7x? | **move it**                  |
| `search:query`   | 0 B     | 0.6 ms !      | 0.1 ms       |   5.2x | nothing to move              |
| `patchSets`      | 1120 KB | 0.1 ms !      | **7.6 ms**   | 198.0x | **no — makes blocking 76x**  |
| `refs:rescan`    | 1407 KB | 2.0 ms !      | **8.6 ms**   |  14.5x | **no — makes blocking 4.3x** |
| `refs:find`      | 0 B     | 0.1 ms !      | 0.1 ms       |     -? | nothing to move              |
| `refs:at`        | 0 B     | 0.1 ms !      | 0.1 ms       |     -? | nothing to move              |

**Both halves of the standing hypothesis were wrong.** `openquestions.md` said
the patch-set store was the likeliest win (a whole-chain rebuild) and the
reference store the likeliest loss (small, frequent queries).

Patch sets is the worst loss on the board, and not because the rebuild is big —
it is 0.1 ms. It is because its ARGUMENTS are every serialized schema in the
project, 1.1 MB, cloned on every single call. The clone is 76 times the work it
was supposed to be moving. References does lose, but in `rescan` (the
whole-project gather), not in the small frequent queries — those are 0.1 ms
either way and there is nothing there to win or lose.

The rule underneath: **a worker is paid by the size of the compute and charged by
the size of the arguments.** Search wins because indexing 141 modules is
genuinely expensive. Patch sets and reference rescan lose because they hand over
the whole project to do a couple of milliseconds of work.

That is a design consequence, not just a benchmark result. The reason those two
pass the whole project is the fix that made the seam crossable at all: the stores
were made pure, so they are handed a snapshot and a query and answer without
interrogating anyone. In-process that is free, because passing a snapshot is
passing a reference. Across a seam it is 1.1 MB. Moving either would need a
STATEFUL seam — each module sent once, then deltas — which is a different API from
the purity that fixed the synchronous-read problem. The tension is real and is
recorded in `openquestions.md` item 5.

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

- **`PUT /patches`.** Unwired in the stores. The engine does that work and the
  stores do not, so every scenario stops before the sync and the engine is not
  charged for it.
- **A real field component.** There IS a React harness now
  (`reactHarness.tsx`), and it produced the clearest result in the exercise: one
  keystroke re-renders 60 components in the engine and 0 in the stores. But its
  field is a `<span>`, so its millisecond column is a floor — a real Val field is
  a rich-text editor. Read the render COUNT, not the time.
- **HTTP.** Same server for both; it would only add noise.
- **The `examples/next` modules themselves.** The handbook fixture there has the
  right shape, but the benchmark still generates its own modules rather than
  importing that app's.

## Reading the output

`ratio` is engine ÷ stores, so above 1 means the stores are faster. A `?` after
it means the two sample ranges **overlap**, and the ratio is therefore not
established by that run — an unmarked 1.4x on overlapping ranges is the single
most misleading thing a benchmark can print. Increase `--reps` before believing
a marked row either way.

`blocking` is the part that runs synchronously inside the keydown handler. It
matters separately from total time: total time can be paid after the character
appears, blocking time cannot.

Runs on a 4-core headless container. Absolute numbers on real hardware will
differ; the ratios and the shape of the scaling are the transferable part.
