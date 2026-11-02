# Results

Each table says when, on what machine and from which command, so it can be
re-run rather than believed. Times are medians unless said otherwise. See
[README.md](README.md) for what each number is a floor or a ceiling of.

## One write in the Studio, by module size

2026-11-01, Claude Code cloud container (Linux, Node 22),
`node --import tsx measure/keystroke.ts`. 40 writes per size.

| Module   | Median   | p90      |
| -------- | -------- | -------- |
| 9 KB     | 0.41 ms  | 0.83 ms  |
| 91 KB    | 1.18 ms  | 2.32 ms  |
| 471 KB   | 6.84 ms  | 13.93 ms |
| 971 KB   | 17.63 ms | 22.88 ms |
| 1,978 KB | 43.12 ms | 50.74 ms |
| 5,026 KB | 113 ms   | 165 ms   |

Linear in the module's size, about 18-22 ms per MB: `SourceStore` clones the
whole module for every patch (`applyPatch(deepClone(module))`). A field writes
once per pause in typing, so this is paid per pause. In a module above about
2 MB it becomes noticeable. This is the cost the plan's copy-on-write engine
(phase 2) is for.

## Evaluating val.modules from source

2026-11-01, same container,
`node --import tsx measure/evaluateValModules.ts <root>`. Native rolldown, so
a floor for the browser.

| Project                   | Modules | Content | Bundle | Bundle (cold / warm) | Evaluate and read (cold / warm) |
| ------------------------- | ------- | ------- | ------ | -------------------- | ------------------------------- |
| templates `tanstack/full` | 9       | 7 KB    | 26 KB  | 34 / 30 ms           | 15 / 11 ms                      |
| valbuild/web              | 20      | 233 KB  | 330 KB | 169 / 99 ms          | 181 / 77 ms                     |

So for a real site, evaluating after every write costs about 0.2-0.35 s in
Node. It runs in the background after a write. The browser's WebAssembly
bundler will be slower, and has not been measured.

## A draft read on Val's server

2026-11-01, same container, quiet machine,
`node --import tsx measure/draftRead.ts all --time-only`. Median of 5 runs in
one process; "retained" is the heap still held after the reads (with
`--expose-gc`, after `gc()`), on top of the modules already loaded.

| Input                   | Content | Draft read (validated) | Without validation | Base only (BaseAlignment) | Retained after |
| ----------------------- | ------- | ---------------------- | ------------------ | ------------------------- | -------------- |
| valbuild/web            | 0.23 MB | 66 ms                  | 26 ms              | 23 ms                     | +1.7 MB        |
| synthetic               | 1 MB    | 66 ms                  | 34 ms              | 20 ms                     | +2.4 MB        |
| synthetic               | 5 MB    | 308 ms                 | 171 ms             | 174 ms                    | +10.1 MB       |
| synthetic               | 10 MB   | 671 ms                 | 434 ms             | 419 ms                    | +19.5 MB       |
| synthetic               | 21 MB   | 1,499 ms               | 890 ms             | 449 ms                    | +38.7 MB       |
| synthetic + 650 patches | 1 MB    | 275 ms                 | 269 ms             | (not run)                 | +2.6 MB        |

What it says:

- **A draft read costs about 65-70 ms per MB of content, on every request**,
  validation about 40% of it. A site of 5 MB pays 0.3 s per draft page view
  before it renders anything. The plan's head (phase 6) makes it a lookup.
- **It keeps about 1.8 times the content's size on the heap afterwards**:
  +39 MB for 21 MB of content, on top of the 36 MB the modules themselves
  take. For an isolate that also holds the app, that is the number that
  matters for 128 MB, and it is a floor (see README).
- **A 650-patch chain adds about 0.2 s per read**, almost all of it applying
  patches (validation adds nothing measurable on top): each patch clones its
  module. The copy-on-write engine (phase 2) is for this.

**Peak heap.** An earlier run bisected the smallest heap each read completes
in (`all`, without `--time-only`). The absolute numbers are dominated by the
process starting up (tsx, the server packages, the Studio's embedded files:
118-157 MB of old space before any read), so only the difference over the
`load` baseline is usable, and only where the read needs more than startup
does: about +15 MB for 5 MB of content and +39 MB for 10 MB, so roughly 3-4
times the content's size at the peak. The run timed out before the 21 MB
draft read. Measuring the read's own peak, rather than the process's, needs a
better method than bisection; noted for the next run.

## Phase 2: the engine, before and after

2026-11-02, same container. `node --import tsx measure/draftRead.ts all
--time-only` and `node --import tsx measure/keystroke.ts`, before and after
`applyPatchRecord` replaced `ValOps.getSources`'s patch loop. **Before ran on
a quiet machine (load 0.2); after ran while another session's Playwright
suite was running (load 9-10 on 4 cores)**, so read the rows without patches
as noise: their code path did not change (no patch is applied).

| Input                   | Draft read before | after  | Without validation before | after  |
| ----------------------- | ----------------- | ------ | ------------------------- | ------ |
| synthetic + 650 patches | 577 ms            | 107 ms | 402 ms                    | 69 ms  |
| synthetic 1 MB          | 132 ms            | 102 ms | 37 ms                     | 47 ms  |
| synthetic 5 MB          | 394 ms            | 392 ms | 228 ms                    | 183 ms |
| valbuild/web            | 95 ms             | 106 ms | 16 ms                     | 15 ms  |

- **A 650-patch chain went from about 0.37 s per read to about 0.03 s** (the
  draft read less the same read with no patches): each patch cloned its 1 MB
  module, and now copies its path. Under load, so the after numbers are a
  ceiling.
- **The keystroke** is the Studio's `SourceStore`, which still applies
  patches with its own `applyPatch(deepClone(module))` until phase 5: 0.36 /
  1.5 / 9.7 / 19.2 / 48.6 / 102 ms before, 0.44 / 2.1 / 12.2 / 18.8 / 44.6 /
  184 ms after (9 KB to 5 MB), the difference being the machine's load.

## Phase 3: the readers on sources, before and after

2026-11-02, same container, quiet, nothing else running.
`pnpm exec tsx measure/draftRead.ts all --time-only`, before and after the
readers moved onto `resolveVal`. Medians:

| Input                   | Draft read before | after   | Without validation before | after  |
| ----------------------- | ----------------- | ------- | ------------------------- | ------ |
| valbuild/web            | 94 ms             | 61 ms   | 25 ms                     | 21 ms  |
| synthetic 1 MB          | 70 ms             | 47 ms   | 21 ms                     | 22 ms  |
| synthetic 5 MB          | 257 ms            | 263 ms  | 112 ms                    | 168 ms |
| synthetic 10 MB         | 560 ms            | 535 ms  | 253 ms                    | 218 ms |
| synthetic 20 MB         | 1105 ms           | 1008 ms | 507 ms                    | 461 ms |
| synthetic + 650 patches | 106 ms            | 64 ms   | 41 ms                     | 39 ms  |

- **No change, as expected.** The script measures the request a draft-mode
  `fetchVal` makes (`PUT /sources/~`, in `serverDraftSource` now), and phase
  3 did not change that request or how often it is made (once per request,
  `memoizePerRequest`). The differences go both ways and are noise; the
  head (phase 6) is what changes this number.
- What phase 3 changes is counted, not timed (B07): a draft `fetchVal`
  resolves twice and encodes once. `draftRead.perf.test.ts` (Next) printed
  39 ms per three-read render with the memo, 79 ms without, after.

## Phase 5: the Studio on the engine, before and after

2026-11-02, same container, quiet (load 0.2-0.4, nothing else running),
`pnpm exec tsx measure/keystroke.ts` three times before and three times
after `SourceStore` moved onto the engine (`studioView.ts`). The median of
each run's median, with the range of the three:

| Module   | Before            | After             |
| -------- | ----------------- | ----------------- |
| 9 KB     | 0.24 (0.23-0.38)  | 0.26 (0.22-0.27)  |
| 91 KB    | 1.16 (1.16-1.26)  | 0.59 (0.57-0.62)  |
| 471 KB   | 6.99 (6.43-7.23)  | 1.73 (1.67-1.80)  |
| 971 KB   | 17.20 (17.1-17.5) | 3.23 (3.00-3.42)  |
| 1,978 KB | 35.92 (33.4-36.4) | 6.40 (6.33-6.70)  |
| 5,026 KB | 101.6 (97-109)    | 19.13 (18.1-19.9) |

- **About five times faster from 0.5 MB up, and no size slower.** Before,
  every patch cloned the whole module (`applyPatch(deepClone(module))`).
  Now a keystroke is one engine apply on the version before it (B01, B09),
  copying the module's ROOT and the edited entry: what is left grows with
  the root's key count (40,000 entries at 5 MB), not with the content
  under it. A module whose root is small pays nothing for its size.
- **That root copy is the floor of copy-on-write for a flat record**, and the
  server's engine pays the same per apply. A spread of the root was tried
  and is about half the speed in V8 for an object this size (dictionary
  mode): 33 ms at 5 MB instead of 19. Getting under it needs a structure
  that shares within a node (a persistent map), not part of this plan.
- Not measured here: a `.jsonValues()` record. A keystroke inside a loaded
  entry costs the entry's path and one copy of the record's root for the
  view (`viewOf`); before, it cloned the module with every loaded entry in
  it.
