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

## The deployed isolate

### Deployed, synthetic content

2026-11-03, the probe (`isolate/`, see "The deployed isolate probe" in
README.md) deployed as a plain Worker with `pnpm dlx wrangler@4.133.0 deploy
--env ""` to a Workers Paid account (the probe's `limits.cpu_ms` of 300 s was
accepted and enforced: one request ended `exceededCpu` at 302 s of CPU).
Bundle: 2,052 KiB, 377 KiB gzipped, as wrangler printed it on upload. Driven
from a Claude Code cloud container with `isolateProbe.ts run` (defaults:
`fresh=1`, one request per row), `wrangler tail --format json` running
throughout, joined with `isolateProbe.ts summarize`. Every 503 the driver saw
was `exceededMemory` in the tail ("Worker exceeded memory limit."), 54 in all,
except the one `exceededCpu` above, which was the retry of a request that had
been killed for memory first. Content is the size of the modules' Source as
JSON (`contentBytes`).

Largest content that was answered / smallest that ended `exceededMemory`:

| Ballast (the app's heap) | `load`                                   | `draft` (validated) | `draft-novalidate` | `base`         |
| ------------------------ | ---------------------------------------- | ------------------- | ------------------ | -------------- |
| none                     | 86.2 MB / never killed                   | 69.9 / 75.3 MB      | 69.9 / 75.3 MB     | 69.9 / 75.3 MB |
| 32 MB                    | 86.2 MB / never killed                   | 53.7 / 59.1 MB      | 64.5 / 69.9 MB     | 64.5 / 69.9 MB |
| 64 MB                    | 86.2 MB (on the retry; first try killed) | 53.7 / 59.1 MB      | 53.7 / 59.1 MB     | 53.7 / 59.1 MB |

The ladder went 1, 2, 5, 10, 15, 20, 30, 40, 60 and 80 MB of synthetic
content, then `--inputs synth:65,synth:70,synth:75` (no ballast) and
`synth:45,synth:50,synth:55` (ballast 32 and 64) to bisect; 1 MB with 650
patches passed every operation it was asked at every ballast.

What else the runs showed:

- **The isolate is replaced after a large draft read, though the read
  answered.** Up to some size each request is answered by the same isolate
  (`#1` to `#30`); from there on the request after a `draft` gets a new one,
  with no `exceededMemory` in the tail for the one before. That size: 42.9 MB
  with no ballast, 32.1 MB with 32 MB, 15.9 MB with 64 MB. Not confirmed why;
  the likely reading is that the isolate ended the request over the limit and
  was retired rather than killed. On a site that is a new isolate, and its
  start, for the next visitor.
- **Ballast counts for far less than its size.** 64 MB of ballast (doubles in
  arrays, 1 MB each) moved the kill by about 16 MB of content, and `load` of
  86 MB answered beside it. So whatever Cloudflare compares with 128 MB is not
  the sum of the two as V8 reports a heap, and the ballast rows are not "what
  is left after an app of N MB". They do show the direction: an app's heap
  lowers the ceiling.
- **CPU, from the tail**: a validated draft read took 1.8 s at 15.9 MB,
  2.6 s at 21.3 MB, 5.2 s at 32.1 MB and 7.4 s at 42.9 MB, about 0.15 s per
  MB, with outliers (5.7 s at 10.5 MB, 40.7 s at 64.5 MB). Starting the
  server (`load`) is of the same order as one read.

**Not run: `--env web`.** It bundles valbuild/web from a checkout beside this
repository (`../web`), and this container had none and could not attach one,
so valbuild/web's 0.23 MB was not measured in a deployed isolate. At 0.23 MB
it is two orders of magnitude under every kill above.

**Not run either: the loader.** This is a plain Worker. A site's isolate is
started by home's loader (`worker_loaders`), and decision 5 of
`docs/plans/one-content-model.md` asks for the probe there; if the two limits
differ, only that one counts.

**Conclusion.** A draft read of today's server, whole tree and validated, is
answered in a deployed isolate with up to about 54 MB of (synthetic) content
beside 64 MB of ballast, and about 70 MB on its own; it is killed at about 59
and 75 MB. Home's rule of thumb (about 15 MB of content crosses 128 MB) is
pessimistic for content of this shape by roughly 4x. The practical ceiling is
lower than the kill: from 16 to 43 MB, depending on the ballast, the isolate
does not outlive the read, and a validated read of 43 MB costs 7 s of CPU.
Real content (deep rich text, `.jsonValues()` entries, media) is untested here
and costs differently. For phase 6: today's draft read does not cross 128 MB
at any size a site has today, so phase 6 does not have to move ahead of 2-5
for memory. The head's 16 MB budget is about where, beside 64 MB of ballast,
the isolate stopped outliving a validated read (15.9 MB), and far under the
kill: a budget that holds, not one with room to spare, and it holds better
once validation leaves the read path. What remains of the check is the same
probe through home's loader, and with valbuild/web's content.

### Deployed, after phase 6

2026-11-03, the same probe and account as "Deployed, synthetic content"
above (a plain Worker, Workers Paid), re-deployed at the commit that records
this with `pnpm dlx wrangler@4.133.0 deploy --env ""` and `--env web`, and
deleted after. Bundle, as wrangler printed it on upload: 2,099 KiB (388 KiB
gzipped), and 2,619 KiB (458 KiB) with valbuild/web (`54bb776`). Driven from
a Claude Code cloud container with `isolateProbe.ts run` (`fresh=1`, one
request per row), `wrangler tail --format json` on both Workers throughout,
joined with `summarize`. 333 requests; every failure was `exceededMemory` in
the tail (74), except three 503s the tail has no event for; no
`exceededCpu`.

What changed since the run above: `draft` (`PUT /sources/~`) is now the
head's whole tree, unvalidated, so it and `draft-novalidate` are one
request. New: `reader`, every module read in-process through
`serverDraftSource` over the head of the server the requests go to -- what a
draft-mode `fetchVal` reads since phase 6, and the number that matters for a
site; and `json:N`, phase 10's project (`scaleProject.ts`): a `.jsonValues()`
router of N posts and image, file and video libraries of N entries each,
local refs. Every answer reports what the head holds (`head.bytes`, the
measure its 16 MB budget is charged with).

Largest content answered / smallest that ended `exceededMemory`, synthetic
(ladder 1, 2, 5, 10, 15, 20, 30, 40, 60, 80 MB; bisected with 65, 70, 75 and,
at 64 MB of ballast, 45, 50, 55):

| Ballast | `load`          | `draft` (whole tree)                 | `draft-novalidate` | `base`         | `reader`        |
| ------- | --------------- | ------------------------------------ | ------------------ | -------------- | --------------- |
| none    | 86.2 MB / never | 69.9 / 75.3 MB (before: 69.9 / 75.3) | 69.9 / 75.3 MB     | 69.9 / 75.3 MB | 86.2 MB / never |
| 32 MB   | 86.2 MB / never | 64.5 / 69.9 MB (before: 53.7 / 59.1) | 64.5 / 69.9 MB     | 64.5 / 69.9 MB | 86.2 MB / never |
| 64 MB   | 86.2 MB / never | 53.7 / 59.1 MB (before: 53.7 / 59.1) | 53.7 / 59.1 MB     | 53.7 / 59.1 MB | 86.2 MB / never |

The same, with a chain of 650 patches on one module (`synth:N+650`; 10, 20,
40, 60 and 80 MB, not bisected). Each request also makes the 650 saves
through the API at that size, so a kill here is the saves and the read
together:

| Ballast | `reader`                           | `draft`                                         |
| ------- | ---------------------------------- | ----------------------------------------------- |
| none    | 86.2 MB / never                    | 64.5 / 86.2 MB                                  |
| 32 MB   | 64.5 / 86.2 MB (killed both tries) | 64.5 MB (on the retry; first try killed) / 86.2 |
| 64 MB   | 86.2 MB / never                    | 42.9 / 64.5 MB                                  |

Phase 10's project (`json:1000`, `json:10000`, `json:10000+650`,
`json:30000+650`, `json:100000`, `json:100000+650`; `load`, `draft`,
`reader`): **every request answered at every ballast**, up to 100,000 posts
(31.6 MB of module source -- the three libraries and the entries' markers --
with the posts' own content behind 100,000 `c.json()` thunks) and 650
patches on the posts. valbuild/web (0.23 MB, `--env web`, three requests per
op): every operation answered at 0, 32 and 64 MB of ballast, one isolate per
ballast, nothing replaced.

**The isolate is replaced after the read** -- the request after it gets a new
isolate, with no `exceededMemory` for the one before (see above). The
smallest size where it happened (and the largest where it did not):

| Ballast | `draft` (whole tree)                | `reader`           | `load`              | `json:100000`                   |
| ------- | ----------------------------------- | ------------------ | ------------------- | ------------------------------- |
| none    | 42.9 MB (32.1 not; before: 42.9 MB) | 86.2 MB (64.5 not) | not seen up to 64.5 | never                           |
| 32 MB   | 32.1 MB (21.3 not; before: 32.1 MB) | 64.5 MB (42.9 not) | 64.5 MB (42.9 not)  | after `draft` only              |
| 64 MB   | 15.9 MB (10.5 not; before: 15.9 MB) | 42.9 MB (32.1 not) | 42.9 MB (32.1 not)  | after every op, `load` included |

**The head**: the most it held after any request was 55,944 bytes
(`synth:80+650`, one module, two versions); with 650 patches on the 10,000-
and 100,000-post routers, 26,400 bytes after `reader` (the 50 edited
entries' copied paths) and 400 bytes after `draft`. Nothing was evicted
anywhere. That is 0.3% of `HEAD_BUDGET_BYTES` (16 MB).

Times: the tail's `cpuTime` is the whole request, and with `fresh=1` that is
mostly building the input and starting the server, which varied about four
times between isolates at one size (`synth:20` `draft`: 11.1 s of CPU in the
ballast-0 ladder, 2.6 s in the 64 MB one). So the tail does not separate the
operation here; `json:10000+650` was 0.5-1.8 s a request, whole. The
isolate's own clock is coarse in a deployed Worker (many reads report 2,000
ms flat), so only its extremes say anything: `reader` took 0-1 ms on
unedited content at every size (every module is the bundle's); with 650
patches, the first read that makes the edited module took 10-68 ms up to
64.5 MB beside 32 and 64 MB of ballast, and 1.7-2.3 s at 64.5 and 86.2 MB in
the other runs. Not investigated; the module it makes is a twentieth of the
content.

- **What a draft page costs no longer has a ceiling of its own.** `reader`
  was never killed in its own right: it passes wherever `load` -- building
  the modules and starting the server -- passes, 86.2 MB at every ballast,
  and is replaced at the same sizes `load` is. Before phase 6 a draft page
  asked the whole-tree read on every request, which is killed at 59-75 MB
  and replaces the isolate from 16-43 MB.
- **The whole tree costs what it cost, less validation.** `draft` now
  equals `draft-novalidate` everywhere; that moved its kill with 32 MB of
  ballast from 59.1 to 69.9 MB and changed nothing else, and the
  replacement sizes are the earlier run's to the megabyte. Phase 7 removes
  its last caller (BaseAlignment).
- **The head's 16 MB budget is not where the limit is.** Real edits hold
  tens of kilobytes (the head charges the paths a patch copied, not the
  module), so the budget is two to three orders of magnitude above what was
  reached, and the isolate's limit is the content the bundle holds, as for
  `load`. Nothing here filled the head to its budget; doing so would take
  patches that write megabytes of new values.
- **Ballast still counts for less than its size** (64 MB of it moved the
  whole-tree kill by 16 MB), and the line is noisy near the edge: with 650
  patches, 86.2 MB `reader` was killed twice beside 32 MB and answered
  beside 64 MB.

**Not run: the loader.** Still a plain Worker, not an isolate started by
home's loader (`worker_loaders`), which decision 5 asks for. If the two
limits differ, only the loader's counts.

**Conclusion.** After phase 6 a draft-mode page fits in a deployed 128 MB
isolate wherever the content itself does: up to 86.2 MB of synthetic content
(the largest step) beside 64 MB of ballast, 100,000 `.jsonValues()` entries
with 650 patches, and valbuild/web, with the head holding at most 56 KB. The
whole-tree read (`/sources/~`) is killed where it was (59-75 MB), less
validation, and is no longer on a page's path. The 16 MB head budget holds
with room to spare; it is not the number that decides the ceiling.

The bundle and workerd sections below are LOCAL, and none of them is evidence
about the 128 MB limit.

### The probe's bundle

2026-11-03, `pnpm dlx wrangler@4.133.0 deploy --dry-run --outdir … --metafile`,
then `isolateProbe.ts bundle`. Unminified, as deployed.

| Build          | Total      | Gzipped   | TypeScript | zod     | core    | shared  | server  | web     |
| -------------- | ---------- | --------- | ---------- | ------- | ------- | ------- | ------- | ------- |
| synthetic only | 12,864 KiB | 2,106 KiB | 10,785 KiB | 600 KiB | 508 KiB | 396 KiB | 366 KiB | -       |
| `--env web`    | 13,390 KiB | 2,177 KiB | 10,789 KiB | 600 KiB | 509 KiB | 396 KiB | 366 KiB | 515 KiB |

- **84% of Val's server, as a Worker bundles it, was the TypeScript
  compiler**, imported by `ValServer.ts` through
  `history/getJsonEntryAtCommit.ts` and by `ValOps.prepare` through
  `patch/ts/publishKit.ts`. Both imports were dynamic, which a bundler that
  writes one file (wrangler) inlines all the same. V8 compiles lazily, but
  the source (about 10.5 MB) is held either way. Fixed below.
- Also in it and not used by a draft read: `modern-screenshot` (60 KiB,
  `shared/internal`'s `pageScreenshot.ts`) and `flexsearch` (80 KiB).

### The probe's bundle without the compiler

2026-11-03, the same commands, after the TypeScript compiler moved behind
`ValServerPlatform.typescript` (the history reader) and
`ValOpsOptions.typescript` (`prepare`), which `nodePlatform` fills and the
browser platform -- the one this probe runs on -- does not.

| Build          | Total     | Gzipped | TypeScript | zod     | core    | shared  | server  | web     |
| -------------- | --------- | ------- | ---------- | ------- | ------- | ------- | ------- | ------- |
| synthetic only | 2,045 KiB | 376 KiB | -          | 600 KiB | 508 KiB | 397 KiB | 334 KiB | -       |
| `--env web`    | 2,565 KiB | 445 KiB | -          | 600 KiB | 509 KiB | 397 KiB | 335 KiB | 515 KiB |

- **From 12.9 MB to 2.0 MB** (gzipped 2.1 MB to 0.4 MB). The rest is the
  modules' own dependencies: zod, core and shared are in the Studio's bundle
  as well.
- **A server on Node still has the compiler**, because it publishes:
  `ValOps.prepare` rewrites each `.val.ts` as text. So does an app that runs
  `createValServer` in a Worker, publishing included; what left is the
  memory-mode server a Worker or a tab starts from `@valbuild/server/browser`.
  `noNodeFromBrowser.test.ts` fails, naming the chain, if the compiler
  becomes reachable from there again, through a dynamic import too.
- **The demo's tab loads what it loaded before.** Bundled for the browser
  with chunks split (esbuild, minified), the entry and its eager chunks are
  695 KiB both before and after; what is gone is a 3.5 MB chunk of the
  compiler that the demo never fetched, and so from the app's build output.

### workerd on this machine (NOT the limit)

2026-11-03, Claude Code cloud container (Linux, 4 cores), `wrangler dev`
(wrangler 4.133.0, workerd 1.20260916.1), `isolateProbe.ts run` with its
defaults (`fresh=1`: each request builds its input; one request per row).
Another session was editing `packages/server` at the time, so wrangler
reloaded the Worker twice (one new isolate, at 80 MB `base`), and the machine
was not quiet. "Op" is the isolate's own clock, which moves locally; "start"
is the server starting and answering `/stat` (and seeding the chain); client
is the whole request, the input's generation included.

| Input                                   | Content | Draft read | Without validation | Base only | Start  | Client (draft) |
| --------------------------------------- | ------- | ---------- | ------------------ | --------- | ------ | -------------- |
| valbuild/web (`--env web`, median of 5) | 0.23 MB | 20 ms      | 7 ms               | 5 ms      | 20 ms  | 134 ms         |
| synthetic                               | 1 MB    | 19 ms      | 7 ms               | 17 ms     | 60 ms  | 94 ms          |
| synthetic                               | 2 MB    | 48 ms      | 13 ms              | 22 ms     | 125 ms | 196 ms         |
| synthetic                               | 5 MB    | 102 ms     | 41 ms              | 33 ms     | 339 ms | 478 ms         |
| synthetic                               | 10 MB   | 164 ms     | 130 ms             | 178 ms    | 752 ms | 987 ms         |
| synthetic                               | 16 MB   | 431 ms     | 143 ms             | 191 ms    | 1.1 s  | 1.7 s          |
| synthetic                               | 21 MB   | 635 ms     | 226 ms             | 344 ms    | 1.3 s  | 2.2 s          |
| synthetic                               | 32 MB   | 694 ms     | 454 ms             | 579 ms    | 2.1 s  | 3.0 s          |
| synthetic                               | 43 MB   | 944 ms     | 501 ms             | 902 ms    | 2.7 s  | 4.0 s          |
| synthetic                               | 65 MB   | 1.2 s      | 744 ms             | 669 ms    | 3.4 s  | 5.0 s          |
| synthetic                               | 86 MB   | 1.7 s      | 917 ms             | 877 ms    | 4.7 s  | 6.8 s          |
| synthetic + 650 patches                 | 1 MB    | 37 ms      | 20 ms              | 6 ms      | 113 ms | 159 ms         |

- **Every size passed, up to 86 MB of content**, which in Node keeps about
  1.8 times its size on the heap after the read. And a separate check held
  600 MB of heap ballast in one isolate (RSS 1.3 GB) with a 200. **So local
  workerd does not enforce 128 MB**, and these rows say nothing about where
  the limit is. The README's open question is closed by this.
- The draft read here costs about 20 ms per MB, where `draftRead.ts` in
  Node measured about 65 ms per MB (phase 3, quiet machine). Not
  investigated: the machines' load differed, and this is one request per
  size, not a median. Starting the server (every module's version and the
  first `/stat`) costs more than one read.

## Phase 6: the head, before and after

### The draft read in Node

2026-11-03, Claude Code cloud container (Linux, 4 cores, Node 22),
`pnpm exec tsx measure/draftRead.ts all --time-only` from `scenarios/`,
before (at 9aa0f309d) and after phase 6. Medians of five reads in one
process; "first" is the slowest of the five, which is the first. **Before
ran on a quiet machine (load 0.03); after started quiet (0.4) and ended at
4.3**, another session's Playwright suite starting part way, so the
`PUT /sources/~` rows after are a ceiling. `reader` is new: every module of
the project through `serverDraftSource`, which is what a draft-mode
`fetchVal` reads since phase 6 (the runtime's head; a module whose newest
version is the build's own passes, and the reader's bundle answers it).

| Input                   | Content | Draft read before (`PUT /sources/~`, validated) | `PUT /sources/~` after (head, no validation) | `reader` after: first / median |
| ----------------------- | ------- | ----------------------------------------------- | -------------------------------------------- | ------------------------------ |
| valbuild/web            | 0.23 MB | 39 ms                                           | 4.4 ms                                       | 3.1 ms / 0.42 ms               |
| synthetic               | 1 MB    | 24 ms                                           | 8.5 ms                                       | 4.2 ms / 0.17 ms               |
| synthetic               | 5 MB    | 115 ms                                          | 41 ms                                        | 6.1 ms / 0.09 ms               |
| synthetic               | 10 MB   | 289 ms                                          | 124 ms                                       | 2.1 ms / 0.09 ms               |
| synthetic               | 21 MB   | 504 ms                                          | 213 ms                                       | 1.9 ms / 0.08 ms               |
| synthetic + 650 patches | 1 MB    | 42 ms                                           | 12 ms                                        | 26 ms / 0.21 ms                |

Before, unvalidated (`draft-novalidate`): 8 / 11 / 52 / 112 / 231 / 21 ms.

- **What a draft page pays went from linear in the site to nothing.** A
  draft-mode `fetchVal` used to cost about 24 ms per MB of content on every
  request, whatever it read. Now a request asks "has the chain moved?" and
  is answered from what the head holds: under half a millisecond for every
  module of valbuild/web, and less for synthetic content that nobody edited
  (it is all read from the bundle, so its size does not show).
- **The first read after an edit makes the edited module once.** 650 patches
  on one module: 26 ms for the read that makes it, then 0.2 ms; a keystroke
  extends the version before by one patch (B06, B12).
- **The heap a read retains** ("after" minus "loaded", in the raw output):
  before, about 1.8 times the content (+38.7 MB at 21 MB); `reader` after,
  +0.05 MB at 21 MB, +0.6 MB with 650 patches -- the head holds the edited
  module's copied paths, and nothing for the rest. `PUT /sources/~` still
  builds its answer (+38 MB at 21 MB), and is now asked only by the Studio's
  BaseAlignment, which phase 7 replaces with `GET /modules`.
- `PUT /sources/~` itself is about 2.4 times faster without previews and
  validation, and the 650-patch row shows the head: 44 ms the first time,
  12 ms after.

### workerd on this machine, after (NOT the limit)

2026-11-03, `pnpm dlx wrangler@4.133.0 dev --env "" --port 8790` from
`measure/isolate/`, driven with `isolateProbe.ts run --url
http://127.0.0.1:8790 --inputs synth:1,synth:5,synth:10,synth:21,synth:43,synth:86,synth:1+650
--repeats 3` (warm isolate: one isolate answered every request). The probe
asks over HTTP (`createInTabValFetch`), so its `draft` is `PUT /sources/~`
-- since phase 6 the whole tree from the head, unvalidated, serialized --
not what a draft reader reads in-process. **Local workerd does not enforce
128 MB** (see "The deployed isolate"), and the machine was loaded (4.4 to
7.1), so these say the probe and the head run in workerd, and nothing about
the limit.

| Content            | `draft` (three reads, isolate clock) | Before phase 6 (one read, earlier run) |
| ------------------ | ------------------------------------ | -------------------------------------- |
| 1 MB               | 10 / 8 / 8 ms                        | 19 ms                                  |
| 5 MB               | 34 / 31 / 31 ms                      | 102 ms                                 |
| 10 MB              | 93 / 90 / 68 ms                      | 164 ms                                 |
| 22 MB              | 194 / 168 / 220 ms                   | 635 ms                                 |
| 46 MB              | 574 / 525 / 391 ms                   | 944 ms (43 MB)                         |
| 93 MB              | 1069 / 1050 / 989 ms                 | 1.7 s (86 MB)                          |
| 1 MB + 650 patches | 46 / 8 / 6 ms                        | 37 ms                                  |

### What to re-run deployed

Items 1 and 2 ran on 2026-11-03, and the 650-patch and 10,000-entry checks of
item 3 on a plain Worker: "Deployed, after phase 6", above. What is left is
item 3's loader. As it was written:

The deployed probe ("The deployed isolate", above) measured the server before
phase 6. To measure the head where Cloudflare enforces 128 MB:

1. Deploy the probe at this commit (`$W deploy --env ""`, and `--env web`
   with a valbuild/web checkout beside this repository), and run the same
   ladders as before, with ballast 0, 32 and 64 MB, `wrangler tail` running:
   `isolateProbe.ts run --url … --ballast N --out …`, then `summarize`. Its
   `draft` is now the head's whole tree unvalidated; compare the kill points
   with the table above (59-75 MB before).
2. Add an operation that reads as a draft reader does, in-process
   (`serverDraftSource` over every module, as `draftRead.ts`'s `reader`), so
   the isolate's cost of a draft PAGE is measured, not of `/sources/~`: the
   probe runs the server through `@valbuild/server/browser`, which builds no
   runtime registry, so this needs the browser entry to hand out its ops'
   head. Expect it far under every kill: it holds the edited modules only.
3. Run it through home's loader (`worker_loaders`), as decision 5 asks, with
   a 650-patch chain and with a `.jsonValues()` record of 10,000 entries
   (phase 10's `scaleWork.ts` shapes), and confirm the head's 16 MB budget
   (`HEAD_BUDGET_BYTES`) is where the isolate keeps outliving a read beside
   the app's own heap.

## Phase 10: the Studio at size (baseline)

2026-11-03, Claude Code cloud container (Linux, 4 cores, Node 22), load
0.2-1.5. Measured on the checkout between `0b8aff9b4` and phase 6, which
another session was landing in the same checkout at the time; re-checked
after phase 6 (`346e6fdc8`): the counts are identical, and `scale.ts run
10000 local` within a few percent on every step, under load 5-6. A BASELINE: measured and reported,
nothing fixed (the decision on what to fix waits for the whole map). The
project is `scaleWork.ts`'s: a `.jsonValues()` router of N posts (title,
slug, rich text, an image picked from the library, tags; a `.preview()`),
image, file and video libraries of N entries each, local refs or remote
(`https://remote.val.build/file/p/…`), and a page whose fields pick from all
three and point at one post (`s.keyOf`). Three instruments:

- **Counted** (`src/scale.scenario.test.ts`, the scenario world, memory
  mode): requests, bytes, entry imports, the stores' work.
  `VAL_SCALE=1000,10000,100000 pnpm test scenarios/src/scale`.
- **Timed** (`measure/scale.ts`): the same surfaces, the real server
  (TanStack's `initValServer`, memory mode) and the Studio's real system in
  one Node process, React left out. `pnpm exec tsx measure/scale.ts all`.
  The heap is server AND Studio, retained after a `gc()`.
- **A real browser** (`e2e/tanstack/scale.spec.ts`): Chromium on
  `examples/tanstack` with `content/scale/` (the same shapes; a `.jsonValues()`
  RECORD, since a router there needs a route file; local media only, whose
  files do not exist, so every thumbnail is a 404).
  `VAL_E2E_SCALE=10000 pnpm exec playwright test --project=tanstack e2e/tanstack/scale.spec.ts`.
  The Studio is Vite's dev server, unbundled (about 1,100 module requests
  per full page load), so a full load is a ceiling for a built Studio; every
  other surface is reached by navigating inside the Studio. Long tasks are
  `PerformanceObserver("longtask")` (over 50 ms); heap is CDP's
  `JSHeapUsedSize` after a forced GC.

### The capacity map

Against the targets decided 2026-11-03 (1k instant: first field under 2 s,
keystroke under 16 ms, no long task over 50 ms while scrolling, nothing
requested that is not on screen; 10k usable: no freeze, crash or lost edit,
progress for anything long; 100k: measured). **fine** meets the size's
target, **degraded** misses it but works, **broken** freezes, crashes or
does not finish. "Stores" is `scale.ts` (local refs; remote is within 10-30%
everywhere except where said), "browser" the Playwright run, "built" that run
against the built Studio (see "The Studio, built", which this map was updated
from) and "dev" against Vite's dev server.

| Surface                                 | 1,000                                                                                                                                                                                                                               | 10,000                                                                                                                                                                                                                            | 100,000                                                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cold start to the first field           | **fine** built: 1.4 s on a quiet machine (2.0-2.6 s under load 6-7), longest task 102-335 ms, 33 MB; the Studio's scripts are in at 1.1 s, the rest is the app's `vite dev` (dev Studio: 5.0 s, longest task 450 ms; stores 37 ms)  | **fine** built: 1.4 s, longest task 260-283 ms, 45 MB (dev Studio: 6.2 s, longest task 2.1 s; stores 163-300 ms)                                                                                                                  | **degraded** built: 4.4 s, a 2.9 s long task, 188 MB (dev Studio: 34 s with a 26 s freeze, 416 MB; stores 1.9-3.1 s, server start 1.3-2.5 s more) |
| Open the record list                    | **fine** built: 117-261 ms, longest task 0-106 ms, 1 GET /json for the 19 rows on screen; stores 14-16 ms (dev Studio: 0.3-0.4 s, longest task 109-194 ms)                                                                          | **fine** built: 261-431 ms, longest task 106-174 ms, 1 GET /json; stores 23-27 ms (dev Studio: 0.6-0.9 s, longest 352-425 ms)                                                                                                     | **degraded** built: 1.6 s, longest task 813 ms, 1 GET /json; stores 0.19-0.21 s                                                                   |
| Scroll the record list                  | **fine** built on a quiet machine: no long task (under load 6-7: 8-11, longest 68-199 ms); one GET /json per window. The scroll reaches 4,500-6,000 px at every size, so this is the list's first 100 or so rows (not investigated) | **fine** (usable) built: 8 long tasks, longest 90-116 ms (dev: 634 ms); same 6,000 px caveat                                                                                                                                      | **degraded** built: 12 s for 40 steps, 17 long tasks, longest 841 ms (dev: 42 s, 8 s)                                                             |
| Open one post                           | **fine**: under 1 ms, nothing requested (the record's reference scans name no module here)                                                                                                                                          | **fine**                                                                                                                                                                                                                          | **fine**                                                                                                                                          |
| Keystroke in a post (stores)            | **fine**: median 1.1 ms, p90 3.6                                                                                                                                                                                                    | **fine**: 2.3 ms, p90 4.6                                                                                                                                                                                                         | **degraded**: 42 ms, p90 52 (the view copies the record's root of 100,000 keys per apply)                                                         |
| Typing on the page that picks (browser) | **fine** built: no long task typing 10 characters, in every run (dev Studio after the fix: longest task 69 ms; 227 ms before)                                                                                                       | **fine** built: no long task (dev after the fix: 75-124 ms; 1.1 s before); the cause was four whole-project derivations per keystroke, see "After" below                                                                          | **fine** built: no long task (dev after the fix: 59-256 ms; a 14 s freeze before)                                                                 |
| Image library: open the gallery         | **fine**: the tiles on screen (about 35); built 131-253 ms, longest task 0-66 ms (dev after the fix 0.4 s; 1,000 `<img>` before)                                                                                                    | **fine**: built 177-239 ms, one task of 56-68 ms, 28 `<img>`, 51 MB (dev after the fix 0.3 s, 207 ms; 6.9 s and 10,000 `<img>` before)                                                                                            | **fine**: built 0.7 s, one task of 547 ms (dev after the fix 0.9 s, 843 ms; 125 s and 1.8 GB before)                                              |
| Image library: scroll the gallery       | **fine** built: no long task over 67 ms, 0-1 of them; 850 thumbnail requests (dev after the fix: 82-93 ms; 3,900 requests before)                                                                                                   | **fine** built: 0-1 long task, at most 67 ms; 1,400 thumbnail requests (105 s and 9,400 before)                                                                                                                                   | **fine** built: no long task (dev after the fix: 135 ms; the tab crashed before)                                                                  |
| Open the picker (source read)           | **fine**: 0.5 ms (the list is virtualized; not driven in the browser)                                                                                                                                                               | **fine**: 1.6 ms                                                                                                                                                                                                                  | **fine**: 30 ms                                                                                                                                   |
| Pick from the library                   | **fine**: 3 ms, one patch, the field reads the ONE library entry by its path (`fillFromGallery` lookup)                                                                                                                             | **fine**: 3 ms                                                                                                                                                                                                                    | **fine**: 4-6 ms                                                                                                                                  |
| `keyOf` dropdown                        | **fine**: built 106-277 ms, no long task, 19 options (1,001 before)                                                                                                                                                                 | **fine**: built 129-167 ms, no long task, 19 options (dev after the fix 96 ms; 6.3 s and 10,001 before)                                                                                                                           | **fine**: built 217 ms, no long task (did not open before); stores 75 ms                                                                          |
| Search, one query                       | **fine**: 17 GET /json for every post; built 0.5-1.4 s with a progress bar, at most one long task of 52 ms; stores 0.4-0.7 s                                                                                                        | **degraded** (usable): 167 GET /json; built 3.4-3.9 s once "used by" has loaded the posts, 1-3 long tasks, longest 74-82 ms, 126 MB (dev: 3.5 s, 75 ms; 3.3 s before); stores 4-7 s, all of it indexing, sliced                   | **degraded** (measured): built 254 s to the first content result, longest task 632 ms, 969 MB; stores 50-90 s, 1.9-2.6 GB                         |
| Gallery: select an image ("used by")    | **fine**, just: built 0.3-0.8 s with a progress bar, one long task of 54-118 ms (dev 0.5 s, 170 ms); 9-17 GET /json                                                                                                                 | **degraded** (usable, long tasks): built 3.2-4.2 s with a progress bar, 19-26 long tasks of up to 130-147 ms (dev: 5.3 s, 29 of up to 263 ms); 99 GET /json. The cause is `useAllValidationErrors`, see "The Studio, built" below | **degraded** (measured): built 42 s, 56 long tasks, longest 2.3 s, 424 MB; 1,066 GET /json; stores 4.8-5.9 s                                      |
| Validate everything (Studio)            | **fine**: 26 ms, loaded content only (unloaded posts are not validated in the Studio)                                                                                                                                               | **fine**: 140-170 ms                                                                                                                                                                                                              | **degraded**: 1.5-1.8 s                                                                                                                           |
| Discard all                             | **fine**: 6 ms                                                                                                                                                                                                                      | **fine**: 9 ms                                                                                                                                                                                                                    | **fine**: 58-102 ms                                                                                                                               |
| Publish one post                        | **fine**: 77 ms; then the Studio re-reads the whole project, `PUT /sources/~`: 314 KB                                                                                                                                               | **degraded**: 223-317 ms; the re-read is 3.2 MB (7.8 MB remote)                                                                                                                                                                   | **degraded**: 2.0-2.8 s; the re-read is 32 MB (79 MB remote)                                                                                      |

Counted at every size (`scale.scenario.test.ts`, the same at 1k, 10k and
100k, local and remote): cold start makes two `/stat` and no `GET /json`,
imports no entry, clones each module once (5) and hashes 10 versions; opening
the record is 19 `GET /json` (12 KB; one since batching), 19 imports, 2 preview computations; a
keystroke is one apply, `engine:clone-bytes` 40 and one version hash, one
`PUT /patches`; the `keyOf` dropdown computes one preview, naming 19 of the N
posts; validation runs `schema-validate` on 3 modules; Discard all rebuilds 2.
What grows with N is only what loads every post (N `GET /json`, N imports, about
650 bytes each; since batching N / 57 requests, see "After: every entry of a
record, in batches") and the re-read after a publish (above).

### The numbers behind it

`measure/scale.ts all`, medians where repeated. ms, and the heap retained
after each step (server and Studio, one process; the baseline with tsx and
the server's packages loaded is about 125 MB).

| Step                                   | 1k local       | 10k local       | 10k remote      | 100k local       | 100k remote      |
| -------------------------------------- | -------------- | --------------- | --------------- | ---------------- | ---------------- |
| Server: start and first /stat          | 52 / 128 MB    | 139 / 135 MB    | 265 / 139 MB    | 1,269 / 215 MB   | 2,524 / 260 MB   |
| Studio: cold start                     | 37 / 129 MB    | 163 / 143 MB    | 302 / 148 MB    | 1,871 / 315 MB   | 3,096 / 360 MB   |
| Open the record                        | 33             | 80              | 86              | 1,111            | 1,174            |
| Keystroke in a post (median / p90)     | 1.1 / 3.6      | 2.3 / 4.6       | 2.3 / 4.0       | 41.8 / 51.8      | 38.3 / 45.3      |
| Open the image picker                  | 0.5            | 1.5             | 1.6             | 33               | 21               |
| Pick the library's last image          | 3.4            | 2.7             | 3.2             | 5.6              | 4.1              |
| `keyOf` dropdown                       | 1.4            | 5.8             | 5.9             | 75               | 74               |
| Validate everything                    | 26             | 140             | 172             | 1,535            | 1,760            |
| Discard all                            | 6.4            | 8.2             | 8.7             | 76               | 65               |
| Publish one post                       | 77             | 223             | 317             | 2,027            | 2,780            |
| Select an image (loads every post)     | 1,036          | 43,726          | 43,477          | out of 8 GB heap | out of 8 GB heap |
| Keystroke, every post loaded           | 0.8 / 1.3      | 2.0 / 2.4       | 2.1 / 2.4       | (not reached)    | (not reached)    |
| Search, one query (loads every post)   | 1,398 / 149 MB | 51,238 / 289 MB | 50,152 / 352 MB | (not reached)    | (not reached)    |
| Validate everything, every post loaded | 36             | 235             | 282             | (not reached)    | (not reached)    |

Loading every post is **quadratic**: 1,000 in about 1 s, 10,000 in about
44 s. A CPU profile of the 5,000 run puts it in two places, both once per
arriving entry: the Studio's `receiveJsonEntry` -> `refreshEntries` ->
`viewOf` -> `copyRoot` (the view of the record is rebuilt, its root of N keys
copied, for every entry that arrives: 13 of 35 s), and the server's
`getJsonEntries` (`Object.keys(record)` of the whole record for every
`GET /json`: 4 s). At 100,000 the process exhausted an 8 GB heap about 200 s
into the load. Why it RETAINS that much was not established; every one of
the 100,000 requests is in flight at once in this process (the Studio starts
them all, `Promise.all`), each holding its own copy of the record's keys on
the server, which is one candidate. A browser sends six at a time per host,
so it would not see the same peak.

The keystroke at 100,000 (42 ms) is the view's root copy too: the engine
counts 40 bytes copied (the edited entry), and `viewOf` copies the record's
root of 100,000 markers for the view on top, which `engine:clone-bytes` does
not count.

### The browser

`e2e/tanstack/scale.spec.ts`, Chromium, one run each.

| Surface                                        | 1,000: ms (longest task, long-task total), heap | 10,000                                          |
| ---------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Cold start to the first field (full load, dev) | 4,983 (450, 775), 70 MB                         | 6,202 (2,062, 2,301), 99 MB                     |
| Typing 10 characters, 40 ms apart              | 2,201 (227, 442), 73 MB                         | 2,226 (1,110, 1,981), 100 MB                    |
| `keyOf` dropdown: open                         | 837 (284, 386), 1,001 options                   | 6,323 (2,351, 4,643), 10,001 options            |
| Open the record list                           | 570 (190, 402), 19 GET /json                    | 1,174 (575, 973), 19 GET /json                  |
| Scroll the record list, 40 steps               | 7,240 (200, 1,308), 138 GET /json               | 10,074 (634, 4,189), 158 GET /json              |
| Open the image gallery                         | 786 (382, 474), 1,000 `<img>`, 88 MB            | 6,933 (2,304, 4,436), 10,000 `<img>`, 212 MB    |
| Scroll the gallery, 40 steps                   | 13,974 (162, 162), 3,932 thumbnail requests     | 105,440 (743, 17,184), 9,386 thumbnail requests |
| Search, one query, to the content results      | 741 (322, 462), 968 GET /json                   | 14,893 (3,287, 8,304), 9,948 GET /json, 153 MB  |

At 100,000 (one run; the test's 30-minute limit ended it):

| Surface                                        | ms (longest task, long-task total), heap                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cold start to the first field (full load, dev) | 34,428 (26,034, 29,649), 416 MB: the tab is frozen for 26 s                                                                                                                                      |
| Typing 10 characters, 40 ms apart              | 14,661 (13,739, 15,643): a 14 s freeze                                                                                                                                                           |
| `keyOf` dropdown: open                         | did not open: the click timed out after 15 s with the tab busy (longest task 23,786 ms), and the page made a full load's requests again during it (it was reloaded; by what was not established) |
| Open the record list                           | 35,119 (15,730, 33,859), 349 MB, 19 GET /json; this included the full page load above                                                                                                            |
| Scroll the record list, 40 steps               | 41,681 (8,026, 25,617), 401 GET /json; `scrollTop` 13,500 px at the end                                                                                                                          |
| Open the image gallery                         | 124,582 (26,939, 74,350), **1,806 MB**, 100,000 `<img>`                                                                                                                                          |
| Scroll the gallery                             | **the tab crashed** ("Target crashed") after 4,165 thumbnail requests                                                                                                                            |
| Search                                         | not reached                                                                                                                                                                                      |

### What looks cheap to fix, and what looks structural

Observations for whoever decides, not decisions.

Looks cheap:

- **The server's `getJsonEntries` reads `Object.keys` of the whole record per
  request** (to check the keys asked for): O(N) per `GET /json`, quadratic
  over a full load. A key lookup would do.
- **The Studio rebuilds the record's view per arriving entry**
  (`refreshEntries` -> `viewOf` -> `copyRoot`), even inside `batched`, where
  the announcement is already deferred to the end. Rebuilding once per batch
  would make a full load linear.
- **One `GET /json` per entry**, though the endpoint takes `keys[]`: the
  window (19) and a full load (N) could go in chunks. `VirtualizedRecordList`'s
  docblock says the window is "requested in one batch"; the store batches the
  announcement, not the request.
- **The gallery renders every tile** (`MediaGallery`: 10,000 `<img>` at 10k,
  +115 MB of heap, a 105 s scroll), where the record list and the picker are
  virtualized. `ModuleGallery` also walks every validation error and every
  patch of the module for each entry.
- **The `keyOf` dropdown renders every key as an option** (10,001), unwindowed.
- **The 404 thumbnails are fetched again and again while scrolling** (3,900
  requests for 1,000 images). Partly this fixture's: real files would be
  cached.

Looks structural:

- **Search and a library entry's "used by" load every entry.** That is the
  design (`useAllJsonValuesLoad`, `jsonValuesLoadRequirements`: a scan cannot
  trust what it has not loaded), and it is N requests and N entries in
  memory, plus the search index (+134-190 MB at 10k in Node). Linear at best;
  at 100,000 it does not finish here. Any library whose files a `.jsonValues()`
  item can pick pays it on every "used by". A server-side index or search
  would move it off the Studio.
- **The Studio re-reads the whole project after a publish** (BaseAlignment's
  `PUT /sources/~`): 32 MB at 100k local, 79 MB with remote refs (their URLs
  are long). Remote refs triple the libraries' bytes.
- **Copy-on-write copies a module's root**: a record of 100,000 entries is
  100,000 root keys per apply, 42 ms a keystroke in the stores (target 16 ms),
  on the server's engine as well. A structure that shares inside a node (a
  persistent map) is what gets under it (phase 5's note).
- **Typing in a field of a page that points at big libraries had a 1.1 s
  long task at 10k**, with nothing of the post record on screen. Not
  investigated: some component on that page recomputes over a whole library
  or the whole project per change.
- **What the Studio validates is what it has loaded**: at any size the
  posts nobody opened are not validated in the Studio (the server's publish
  gate is the check), and the `keyOf` dropdown names only the loaded posts.

### After: the gallery, the reference dropdowns and the typing freeze

Fixed 2026-11-03 (`1e4bf4eaf`, `cda48c1b3`, `cff7204d5`, budgets in
`84fd22d86`). The browser numbers are `e2e/tanstack/scale.spec.ts` against a
copy of `examples/tanstack` served from a worktree at the branch's head (so
the other session's edits to the same checkout could not reload the page
mid-run), one run each, with that session's suites running alongside (load
4-8 on 4 cores): treat the milliseconds as an upper bound.

**The typing freeze.** A Chromium CPU profile of typing on the page that
picks (`Profiler.start` over CDP around the ten keystrokes) put 1.45 s of
the 2.2 s in React renders, all of it in four whole-project derivations that
every keystroke re-ran and none of which is about the module being edited:

| Where                                                                                                | Per 10 keystrokes at 10k, before | What it did                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArrayAndRecordTools` -> `useJsonEntriesProgress` -> `SourceStore.allEntriesProgress` -> `markersOf` | 547 ms                           | counted every `.jsonValues()` marker of every module on every READ, and every progress hook reads on every render: the 10,000 posts, several times a keystroke |
| `ArrayAndRecordTools` -> `useKeysOf` -> `getKeysOf` -> `traverseSchemas`                             | 293 ms                           | the page header's `keyOf` scan walked every module's source (30,000 library entries) at the root of an OBJECT page, which shows no references                  |
| `KeySelector`                                                                                        | 341 ms                           | built 10,001 option elements on every render of the `keyOf` field, closed or open (they were written inline under the popover)                                 |
| `ValShell` -> `useShellData` -> `toMediaFiles`                                                       | 152 ms                           | listed and sorted every library's files again whenever the patch list or the validation errors moved                                                           |

Fixed in the product: markers and progress are counted once per view of a
module (`source:count-entries`) and kept until the view or a fetch's outcome
moves; the header scans only where something shows the answer
(`keyOfScanTarget`), and a scan walks only modules whose schema can hold a
`keyOf` to the target (`keyOfScanScope`); the dropdown's options are built
only while it is open, and only those on screen; the shell's file lists are
a memo of their own over the galleries' source, and
`useShallowModulesAtPaths` hands back the same answer while its modules are
unchanged. After, the same profile at 10k: longest task 84 ms, 146 ms of
long tasks, nothing in it that walks a library; at 100k the one thing left
that grows is `ValidationStore`'s `keysOf` of the record the `keyOf` points
at (19 ms, once per validation pass, not per keystroke).

**Windowing.** The gallery's grid and list, and the reference dropdowns
(`KeySelector`, `RouteSelector`, now `WindowedOptionList`), render only what
is on screen through the virtualizer the record list and the media picker
use (`@tanstack/react-virtual`), past the record list's threshold of 50. The
dropdown filters itself (every word of the search, in order), keeps the
focus in its search (and now gets it on open, which inside the shadow root
Radix could not give it), moves with the arrow keys, Home and End, scrolls
the active option into the window and names it with
`aria-activedescendant`, each option carrying `aria-setsize`/`aria-posinset`;
it opens on the field's value. The gallery's columns are worked out as its
`auto-fill` grid would make them; an entry opened from elsewhere is scrolled
to; Tab walks the tiles in order. `ModuleGallery` indexes the validation
errors and the pending patches by entry in one pass each instead of walking
all of them for every entry, and keeps its items until what they are made
of changes.

| Surface (browser): ms (longest task, long-task total) | 1,000 before                                | 1,000 after                | 10,000 before                                | 10,000 after                      | 100,000 before                     | 100,000 after                               |
| ----------------------------------------------------- | ------------------------------------------- | -------------------------- | -------------------------------------------- | --------------------------------- | ---------------------------------- | ------------------------------------------- |
| Typing 10 characters, 40 ms apart                     | 2,201 (227, 442)                            | 2,110 (69, 184)            | 2,226 (1,110, 1,981)                         | 2,199 (83, 361)                   | 14,661 (13,739, 15,643)            | 2,182 (256, 609); profiled alone: (59, 172) |
| `keyOf` dropdown: open                                | 837 (284, 386), 1,001 options               | 162 (77, 77), 19 options   | 6,323 (2,351, 4,643), 10,001 options         | 309 (96, 96), 19 options          | did not open in 15 s               | 241 (96, 96), 19 options                    |
| Open the image gallery                                | 786 (382, 474), 1,000 `<img>`               | 406 (158, 295), 28 `<img>` | 6,933 (2,304, 4,436), 10,000 `<img>`, 212 MB | 279 (207, 207), 28 `<img>`, 88 MB | 124,582 (26,939, 74,350), 1,806 MB | 887 (843, 843), 28 `<img>`, 249 MB          |
| Scroll the gallery, 40 steps                          | 13,974 (162, 162), 3,932 thumbnail requests | 5,168 (93, 730), 860       | 105,440 (743, 17,184), 9,386                 | 5,892 (146, 1,263), 1,395         | the tab crashed                    | 5,672 (135, 1,131), 1,395                   |

A tile whose picture 404s shows its name instead of an `<img>`, so `<img>`
counts the tiles with a picture: about 35 tiles are on screen at
1,280 × 720. The scroll's wall time has a floor of 3 s (40 steps 50 ms apart,
then a second's wait). The 100k heap includes every post, which "used by"
loaded in the step before.

Budgets, so none of it comes back:

- `scenarios/src/scalePage.scenario.test.ts` (the world): ten keystrokes on
  the page that picks cost the same work next to libraries of N entries as
  next to libraries of 10 -- requests, the engine's copies, versions hashed,
  listeners woken, entries counted (`source:count-entries`), previews,
  validations -- local and remote; the page makes no reference scan, and a
  scan for references to the record it points at walks the page alone.
- `packages/ui/spa/stores/entriesProgress.test.ts`: a module's entries are
  counted once however often they are asked about, not again for a
  keystroke in another module, and again when an entry arrives or fails.
- `packages/ui/spa/components/fields/KeySelector.test.tsx` (jsdom, a 300 px
  list of 36 px options): no option while closed; open, the window and its
  overscan of 10,000; a key 10,000 down found by search and by End and
  picked with Enter; it opens on a value 7,000 down; "New entry" is reached
  whatever the search.
- `packages/ui/spa/components/MediaGallery/MediaGallery.test.tsx` (jsdom, a
  1,000 × 600 grid): the tiles and `<img>` on screen, not the 10,000
  entries, in the grid and in the list; a click picks; a search finds the
  last entry; an entry opened from elsewhere is rendered.

Seen while measuring, not fixed here: search (`system.search`) never
answered in the browser at the branch's head at 1k and 10k (the dialog
stays on "Searching…" with every post loaded; with this commit's entry
counting switched off it hangs the same way), and the page reloaded itself
once during the 10k search step. (Found and fixed after: interleaved
search passes undoing each other, see "After: every entry of a record, in
batches".)

### After: every entry of a record, in batches

Fixed 2026-11-03 (`47e3d5004`, `bfa3d3fb7`, `278990a7c`, `900401a25`,
`3d8566e11`, `1b95d1979`, `e9e604618`; budgets in `1f08b6517`), on top of
the server half (`c5ed3b9b9`: a `GET /json` costs the entries it asks for,
not the record).

What it was: per arriving entry, `receiveJsonEntry` -> `refreshEntries` ->
`viewOf` -> `copyRoot` rebuilt the record's view, and the Studio sent one
`GET /json` per entry though the endpoint takes `keys`. What it is now:

- **Requests carry many keys.** A read (`get`, a record's window) is asked
  for at once, and the reads of one tick go out as one request
  (`chunkJsonEntryKeys`, 25 keys): opening the record is 1 `GET /json`, not 19.
  `loadAllEntries` (search, "used by", a rename guard) sends batches as large
  as the URL budget allows (57 keys of `/blog/post-12345`, 100 of `post-123`),
  at most 3 in flight across the store, behind every read.
- **What landed is applied as one batch** (`receiveJsonEntries`): one view,
  one revision, one wake. A bulk load applies in twentieths (at least 200
  entries, or all that is left), after a `yieldToMain`, so the browser gets a
  turn between them; a read applies as it lands.
- **Search indexes what arrived**: a record module is indexed by entry, and
  an entry that is the same object keeps its documents; indexing runs in
  12 ms slices with the thread let go between (`search:index-slice`).
- **"Used by" walks only what can point at the gallery**, by entry, keeping
  what it found in an entry that did not change; while the load runs it
  scans in tenths of it.
- **The editor sees it**: a bar with "2,300 of 10,000" in the global search,
  the module search and the gallery inspector's "Used in", the places and
  hits found so far above it, Try again (`retryEntries`) with the server's
  words under Details when a batch fails, and the unsent batches dropped when
  nobody is waiting any more (search closed, inspector left).

Counted (`scale.scenario.test.ts`, local media; gated): opening the record is
1 `GET /json` and 1 apply for the 19 rows; loading every post is
`ceil(N / keys per request)` requests and never more applies than requests.

| Loading every post (counted)  | 1,000         | 10,000       | 100,000               |
| ----------------------------- | ------------- | ------------ | --------------------- |
| `GET /json`, before           | 981-1,000     | 9,981-10,000 | (out of 8 GB of heap) |
| `GET /json`, after            | 17            | 167          | 1,746                 |
| View rebuilds, before / after | 1,000 / 1     | 10,000 / 1   | - / 1                 |
| KB answered, after            | 386 (540 rem) | 3,919        | 39,801                |

(One apply in the world: its network answers in-process, so every batch has
landed before the yield. In the browser it is about twenty.)

Timed (`measure/scale.ts`, Node, server and Studio in one process; load
2.5-8 with other sessions' suites alongside, so a range of runs):

| Step                                  | 1k before / after | 10k before / after      | 100k before / after                    |
| ------------------------------------- | ----------------- | ----------------------- | -------------------------------------- |
| Open the record                       | 33 / 14-16 ms     | 80 / 23-27 ms           | 1,111 / 187-212 ms                     |
| Select an image ("used by")           | 1,036 / 77-111 ms | 43,726 / 452-640 ms     | out of 8 GB / 4.8-5.9 s, +150 MB       |
| Search, one query (loads every post)  | 1,398 / 542-669   | 51,238 / 3,990-8,646 ms | not reached / 50-90 s, heap 1.9-2.6 GB |
| Keystroke, every post loaded (median) | 0.8 / 1.7-1.8 ms  | 2.0 / 4.5-6.3 ms        | not reached / 71-77 ms (p90 100-133)   |

Search's time after loading is indexing (FlexSearch, every leaf of the
posts and the three libraries); it is linear now and sliced, not faster per
document. At 100,000 the index is what holds the 1.9-2.6 GB. The keystroke
with every post loaded at 100k is `viewOf` filling 100,000 loaded entries
into the view per apply, on top of the root copy (the structural item
above).

Browser (`e2e/tanstack/scale.spec.ts` from a worktree at `a1f38eff1`, its own
Studio dev server, on a quiet machine, load 1-3; earlier runs under load 8-14
were up to 2x slower in every row):

| Surface: ms (long tasks, longest, long-task total) | 1,000 before                  | 1,000 after                               | 10,000 before                          | 10,000 after                                     |
| -------------------------------------------------- | ----------------------------- | ----------------------------------------- | -------------------------------------- | ------------------------------------------------ |
| Open the record list                               | 570 (190, 402), 19 GET /json  | 352 (4, 118, 312), 1 GET /json            | 1,174 (575, 973), 19 GET /json         | 467 (3, 194, 339), 1 GET /json                   |
| Select an image: "used by" (loads every post)      | not measured                  | 498 (2, 170, 229), 9 GET /json, bar shown | not measured (43.5 s in Node)          | 5,344 (29, 263, 3,915), 99 GET /json, bar shown  |
| Search, one query (after "used by")                | 741 (322, 462), 968 GET /json | 861 (1, 69, 69)                           | 14,893 (3,287, 8,304), 9,948 GET /json | 3,509 (2, 75, 131)                               |
| Search from a cold Studio (loads every post)       | -                             | about 5 s to the last result, bar shown   | -                                      | loaded in under 10 s, results by 10 s, bar shown |

(The scale spec's search runs after "used by" has loaded the posts, so it
times the indexing; the cold row is a separate run that opens search on a
fresh Studio. Timed in Node on the same quiet machine: "used by" 56 ms at
1k and 313-324 ms at 10k, search 0.41-0.64 s and 4.0-7.1 s.)

**Search froze the tab, and was fixed here** (`61c99e19b`, `a9d2547cc`,
`b0c72fec5`, `a1f38eff1`). From a cold Studio at 10,000 posts the tab stopped
answering at about 3,000 posts loaded and search never came back (the
windowing session saw the same, as "Searching…" for good). The cause was
`900401a25`: a pass over the index lets the thread go between slices, and
the Studio asks again as each batch lands, so passes with different
snapshots of the record ran interleaved on one index; a record is indexed
by entry identity, so each took out what the other had just put in, with
the removals not looking at the clock, and none finished. `SearchStore` now
runs its passes one after the other, a pass asked for while one waits joins
it with the newest snapshot, and a module indexed from the same source
again is not walked (removing a document from FlexSearch looks for it
everywhere: the project's small modules re-indexed per pass were 4.4 s of
removals in one task). `searchPasses.test.ts` starts passes together; before
the fix the test run hung.

What is left, and why it is not this fix: the long tasks during "used by" at
10k are React re-rendering the shell for each applied batch -- a CPU profile
puts 50-180 ms per batch in `performWorkOnRoot` under load, of which this
fix's own work (`applyLanded`, the progress counts, the "used by" scan) is
10-40 ms; the rest is whole-project readers (the shell, the AI panel, the
status bar, thumbnails) in React's dev build. Pacing the applies to
twentieths cut them from about a hundred to about twenty, and to 29 long
tasks in all on a quiet machine (longest 263 ms). The Studio stays usable (no freeze of a second, typing and
navigation answer between batches), but "no long task over 50 ms" is not
met for "used by" at 10k in a dev build; a built Studio, or whole-project
readers that do not re-render for a `.jsonValues()` batch, would be the next
step.

### The Studio, built

Measured 2026-11-03 at `cf400fdfd`, on the built Studio: the production
bundle (`NODE_ENV=production`, minified) that `pnpm run build` embeds in
`@valbuild/ui/server` and the app serves from `/api/val/static`, which is
what a project installed from npm runs. Every earlier browser number in
this section is Vite's dev server: unbundled (about 1,100 module requests
per full load), React's development build, `jsxDEV`. The app around it is
still `examples/tanstack` under `vite dev`, so a full load also makes the
app's own 234 unbundled module requests; the cold-start row says when the
Studio's scripts had arrived, which is what separates the two.

How: `pnpm run build`, then
`VAL_E2E_SCALE=10000 pnpm exec playwright test --project=tanstack --no-deps e2e/tanstack/scale.spec.ts`,
then `pnpm preconstruct dev`. `--no-deps` skips the warmup project, whose
wait reads `__VAL_STORES__`, which a production build does not expose; the
spec now waits for the first field instead and says in its table heading
which Studio it measured. Nothing else in the product or the spec changed.

Chromium, one machine (4 cores). 1k and 10k three runs each: two at load
2.5-7 (other sessions' suites) and one on a quiet machine (load under 2),
given as a range; 100k one run on a quiet machine. ms (long tasks, longest,
long-task total), heap after a forced GC. "Dev" is the latest dev-Studio
number above ("After" sections; the baseline where nothing came after).

| Surface                                       | 1k dev                     | 1k built                                                                     | 10k dev                        | 10k built                                                           | 100k dev                           | 100k built                                           |
| --------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| Cold start to the first field (full load)     | 4,983 (?, 450, 775), 70 MB | 1,416-2,621 (2-4, 102-335, 166-642), 33 MB; Studio's scripts in at 1.1-2.0 s | 6,202 (?, 2,062, 2,301), 99 MB | 1,397-1,450 (1-3, 260-283, 260-395), 45 MB; scripts in at 1.2-1.3 s | 34,428 (?, 26,034, 29,649), 416 MB | 4,378 (6, 2,877, 3,212), 188 MB; scripts in at 4.2 s |
| Typing 10 characters, 40 ms apart             | 2,110 (?, 69, 184)         | 2,152-2,555 (0)                                                              | 2,199 (?, 83, 361)             | 2,185-2,275 (0)                                                     | 2,182 (?, 256, 609)                | 2,222 (0)                                            |
| `keyOf` dropdown: open                        | 162 (?, 77, 77)            | 106-277 (0)                                                                  | 309 (?, 96, 96)                | 129-167 (0)                                                         | 241 (?, 96, 96)                    | 217 (0)                                              |
| Open the record list                          | 352 (4, 118, 312)          | 117-261 (0-2, 0-106, 0-137)                                                  | 467 (3, 194, 339)              | 261-431 (2, 106-174, 159-250)                                       | 35,119 (with a reload)             | 1,646 (3, 813, 1,482)                                |
| Scroll the record list, 40 steps              | 7,240 (?, 200, 1,308)      | 5,140-8,979 (0-11, 0-199, 0-834)                                             | 10,074 (?, 634, 4,189)         | 5,229-7,324 (8, 90-116, 538-687)                                    | 41,681 (?, 8,026, 25,617)          | 12,104 (17, 841, 6,000)                              |
| Open the image gallery                        | 406 (?, 158, 295)          | 131-253 (0-1, 0-66, 0-66)                                                    | 279 (?, 207, 207), 88 MB       | 177-239 (1, 56-68, 56-68), 51 MB                                    | 887 (?, 843, 843), 249 MB          | 687 (1, 547, 547), 217 MB                            |
| Select an image: "used by" (loads every post) | 498 (2, 170, 229)          | 296-841 (1, 54-118, 54-118)                                                  | 5,344 (29, 263, 3,915)         | 3,177-4,155 (19-26, 130-145, 1,618-2,242), 65 MB                    | not measured                       | 42,250 (56, 2,302, 35,622), 424 MB                   |
| Scroll the gallery, 40 steps                  | 5,168 (?, 93, 730)         | 4,835-6,090 (0-1, 0-67, 0-67)                                                | 5,892 (?, 146, 1,263)          | 5,611-6,725 (0-1, 0-67, 0-67)                                       | 5,672 (?, 135, 1,131)              | 5,977 (0)                                            |
| Search, one query (after "used by")           | 861 (1, 69, 69)            | 547-1,369 (0-1, 0-52, 0-52)                                                  | 3,509 (2, 75, 131)             | 3,363-3,909 (1-3, 74-82, 74-197), 126 MB                            | not reached                        | 254,250 (17, 632, 2,777), 969 MB                     |

(`?`: the dev table gives the longest task and the total, not the count.
The scroll's wall time has a floor of 3 s; typing's of about 2 s, the
keystrokes' own spacing and the waits around them.)

Against the targets:

| Target                                             | Met on the built Studio?                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1k: first field under 2 s                          | **Yes** on a quiet machine, 1.4 s; 2.0-2.6 s at load 6-7. About 1.1 s of it is before the Studio's scripts have arrived, which is the app under `vite dev`; the Studio's own share is about 0.35 s. A production build of the app would be the same or better, not measured.                                                                      |
| 1k: a keystroke under 16 ms                        | **Not contradicted**: no long task while typing at any size, in any run, and the stores' keystroke is 1.1 ms (median). The browser run measures tasks over 50 ms, not per-keystroke frames.                                                                                                                                                       |
| 1k: no long task over 50 ms while scrolling        | **Yes** on a quiet machine, the record list and the gallery both (no long task in 40 steps). Under load 6-7 the record list had 8-11 of up to 68-199 ms. The record list's scroll stopped at 4,500-6,000 px at every size, so it covered its first hundred or so rows: the list was being remounted (see "After: 'used by' filtered once" below). |
| 1k: nothing requested that is not on screen        | **Yes**: opening the record is one GET /json for the 19 rows; the gallery requests the tiles on screen.                                                                                                                                                                                                                                           |
| 10k: no freeze, crash or lost edit; progress shown | **Yes**: no task over 300 ms on any surface; the longest, 283 ms, at cold start; "used by" and search show their bar.                                                                                                                                                                                                                             |
| 10k: search without a long task over 50 ms         | **No, narrowly**: 1-3 long tasks of 74-82 ms (the same as the dev Studio's 75 ms).                                                                                                                                                                                                                                                                |
| 10k: "used by" without a long task over 50 ms      | **No**: 19-26 long tasks of up to 130-147 ms in four runs of five (the fifth: one, 132 ms). Halved against the dev Studio (263 ms), not gone. Cause below.                                                                                                                                                                                        |

The build removed what the dev Studio's own cost was: typing, the `keyOf`
dropdown and the gallery have no long task left, opening the record list
is faster, and most of a cold start is the app's. 100k now loads in 4.4 s where the dev
Studio froze for 26 s, and every surface finishes; "used by" (42 s, tasks
up to 2.3 s) and search (4 minutes to the first result, 969 MB) are the
ones that do not hold up there.

**"Used by" at 10k: where the long tasks are.** A CPU profile (CDP
`Profiler`, 200 µs sampling) of the step in the spec's own sequence, on a
Studio built the same way but unminified so the frames have names. In the
runs with long tasks, 1.0 s of the 3.4 s busy time is
`useAllValidationErrors` (`components/ValErrorProvider.tsx`), 775 ms of it in
`filterBlockingValidationErrors` -> `resolveSchemaSourceFixes` /
`partitionValidationErrors`. The tasks grow as the load goes on, 56 ms at the
first batch to 332 ms at the last, and in that last one 178 ms is this hook.

- Every post picks its image from the library, so the post's validation
  reports an `image:check-gallery` marker, which is answered against the
  gallery's current source. 10,000 loaded posts are 10,000 markers, every one of which resolves
  to nothing to show.
- `useAllValidationErrors` is a hook, not a store: each component that calls
  it holds its own memo and wakes on every `validation:result` and
  `validation:invalidate` in the project. On the gallery page eight are
  mounted (`ValShellBody`, `useShellData`, `useNavMenuData`, `PublishButton`,
  `useValidateCount`, `useProposalsBar`, `useAIValidation`, `ModuleGallery`),
  so each validation event runs the whole-project filter eight times.
- A batch of posts landing invalidates the posts module and revalidates it
  (its last answer "had errors": the raw markers), so there is one event per
  batch: about twenty batches x eight filters x every marker loaded so far.
  The comparison at the end (`sameErrors`) hands back the same object, so
  nothing downstream re-renders; it is the filtering itself that costs.
- It happens when the posts module has been validated before the load (the
  spec opens the record list first; four runs of five). The runs without it
  have one long task, at the click, of 127-154 ms: opening the inspector
  (`GalleryEntryInspector` -> `useReferencedFiles`, its first scan),
  `ModuleGallery`'s items and the first batch's start, 10-60 ms each.

Proposed fix, not made here: compute the surfaced errors once per
validation event for the whole Studio instead of once per consumer -- a
cached selector on `ValidationStore` (or the existing, empty
`ValErrorProvider` holding the value in a context) that the hook reads --
and resolve and partition per module, keeping a module's answer while its
result object and the galleries and records its markers read are unchanged
(`keyOfRecordPath` already names those). The first part is about 60-100
lines in `ValErrorProvider.tsx` plus a test that counts filter runs per
event (eight to one); with the second, a batch re-filters only the posts
module, which at 10k is about 17 ms at the end of the load (the profile's 133 ms
over eight). Small to
medium; it should take the 10k load to the click's one task. That one
(127-154 ms) is a separate, smaller item: run the inspector's first scan
after it has painted, as its later slices already are.

### After: "used by" filtered once, and the record list that kept its scroll

Measured 2026-11-08, after the release that shipped the plan (0.151.0), on
the built Studio, the same way as above (`pnpm run build`, then
`VAL_E2E_SCALE=10000 pnpm exec playwright test --project=tanstack --no-deps
e2e/tanstack/scale.spec.ts`, then `pnpm preconstruct dev`). Another machine
than the table above (4 cores, load 2.2-2.7), so `main` at `07723a2` was
measured on it first, once, and the change three times.

What changed, each with a test that fails without it:

- **The surfaced errors are worked out once per validation event, per
  module** (`ValidationStore.surfacedOf`, `surfacedErrors`). Each caller of
  `useAllValidationErrors` used to filter every validated module on every
  validation event; eight are mounted on the gallery page. Now a module is
  filtered once per result object, for a field under it and the whole
  project alike, and every whole-project reader gets one reference-stable
  snapshot through `useSyncExternalStore`
  (`surfacedValidationErrors.test.tsx`: eight readers, one filter per
  event, and only of the module whose result is new).
- **The hook asks for a stale module again only when it SHOWS an error.**
  It asked when the raw answer had any error, and the posts module's raw
  answer is 10,000 `image:check-gallery` markers that resolve to nothing. So
  every batch of the load revalidated the posts module, and each pass sent
  the whole module (up to 10,000 loaded posts) to the validation worker:
  `postMessage`'s structured clone was 314 ms of main-thread self time in
  the profile, `collectCustomValidateTargets` another 129 ms. Same test file,
  "does not ask again for a stale module that shows nothing".
- **`entriesStatus` is stable by key** (the views it read and the failures
  recorded), not by recompute-and-compare: it walked every marker on every
  render of the reference scan's status, 93 ms over the load
  (`jsonValuesBatches.test.ts`, "is worked out once per view").
- **The gallery inspector scans after it has painted**
  (`useReferencedFiles.test.tsx`); until then its answer is "loading", so
  Delete and Rename stay gated.
- **The record list kept being remounted, which is why its scroll stopped at
  4,500-6,000 px.** `RecordFields` chose between preview rows and cards from
  the preview's data, which a preview being recomputed does not have, and
  every batch of entries landing makes the preview owed again: cards for a
  moment, then preview rows -- a different component, so a new scroll
  viewport at the top. A probe that marked the viewport saw it replaced at
  steps 1, 2, 5, 9, 14, 20, 27 and 35 of the 40, so the spec's last step
  always ended a few screens down. An editor scrolling with a wheel was
  thrown back to the top the same way. The choice is now held while the
  preview is recomputed (`RecordFields.test.tsx`, "keeps the list it drew").

| Surface: ms (long tasks, longest, long-task total) | `main` (1 run)               | after (3 runs)                                       |
| -------------------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| Select an image: "used by" (loads every post)      | 3,492 (21, 179, 1,988)       | 1,692-1,720 (3-6, 76-90, 191-332), 92 GET /json      |
| Scroll the record list, 40 steps of 1,500 px       | 4,835 (9, 93, 736), 6,000 px | 7,636-7,921 (39-40, 106-144, 2,834-2,927), 60,000 px |
| Every other surface                                | as above                     | unchanged within noise                               |

An intermediate run, with the per-module filter and the deferred scan but
before the other two changes, measured "used by" at 1,638-2,428 ms with
4-18 long tasks of up to 74-93 ms.

**"Used by" at 10k: what is left.** A CPU profile of the step (unminified
build, 200 µs sampling) after the changes: 1,228 ms busy, down from 2,190 ms
in the same profile before them. Of it: the posts module's preview, computed
again over every loaded post at each batch, because the "Used in" rows title
the posts that use the image (`executePreview`, about 196 ms); the scan
itself, in tenths of the load as designed (`getReferencedFiles`, about
153 ms); applying each batch (`receiveJsonEntries`, about 130 ms); and React
rendering what those moved. No validation is left in it. The 3-6 long tasks
of 76-90 ms are those, at the batches where they coincide; meeting "no long
task over 50 ms" needs either a preview per entry rather than per module, or
the rows titled after the load rather than during it -- both larger than
this fix, and not done.

**The record list's scroll, now that it scrolls.** Forty steps of 1,500 px
through 10,000 posts load about 480 rows, one `GET /json` per step, and cost
one long task per step of up to 106-144 ms. Not profiled yet; the likely
parts are the record's view rebuilt per batch (its root copied: 10,000 keys)
and the posts module's preview computed again over every loaded post, as in
"used by". Before this change the number was not comparable: the list was
remounted before it got past the first hundred rows.

### After: the record list's scroll, profiled

Measured 2026-11-08, the same way, three runs (load 1.5-2.3). A CPU profile
of the forty scroll steps (unminified build) put 3.7 s of busy time in
several walks of the whole record, each repeated for every batch of entries
that landed, at 10,000 keys:

- **The "Add" button built the record's keys on every render**, twice
  (`AddRecordPopover`: 214 ms), for a form that is only drawn while its
  popover is open. The forms now take the record and derive its keys when
  they render. Reading it found a bug: the plain "Add" form refused a key with
  `key in existingKeys`, on an ARRAY of keys, which asks whether the key is an
  array index -- so a key the record already had was accepted (the add wrote
  over that entry), and a new key spelled like an index ("0", "12") was
  refused (`AddRecordPopover.test.tsx`).
- **The list asked `entryError` for every key on every render** to know which
  rows have no content yet (`useJsonEntryRowStates`: 265 ms). The store had
  that answer already, per view of the module (`markersOf`); it is now one
  cached answer, `SourceStore.rowStates` (`jsonValuesBatches.test.ts`).

| Surface: ms (long tasks, longest, long-task total) | before (3 runs, above)                    | after (3 runs)                           |
| -------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| Scroll the record list, 40 steps of 1,500 px       | 7,636-7,921 (39-40, 106-144, 2,834-2,927) | 5,964-6,336 (29-33, 87-111, 1,734-2,152) |
| Select an image: "used by"                         | 1,692-1,720 (3-6, 76-90, 191-332)         | 1,589-1,627 (1, 63-69, 63-69)            |

("Used by" gained too: the gallery's header has the same "Add" button.)

What is left in the scroll, per batch and each a walk of the whole posts
module, from the second profile (3.5 s busy):

- **Its validation**: the module page's own errors (`Module.tsx`'s
  `useValidationErrors`) demand the module, every batch makes it stale, and
  each pass sends the whole module to the validation worker -- the
  structured clone alone was 172 ms of main-thread time. Validating entries
  as they arrive, rather than the module, is the fix, and a design question.
- **Its preview**, computed again over every loaded post (`executePreview`,
  about 235 ms), as in "used by".
- **Counting its markers** (`markersOf`, about 178 ms), once per view by
  design: what a read would find is counted from the view.
- **Mapping its keys to paths** (`useShallowSourceAtPath`, about 236 ms).

### Not measured, and why

- **Upload, and bulk upload into a 10k library** (`ModuleGallery` uploads
  dropped files one after another): needs the browser's file input and
  encoder; not driven at size here.
- **The Pages tree and sitemap with 10,000 routes**: the browser fixture is a
  record (a router in `examples/tanstack` needs a route file), and the world
  has no React to render the tree.
- **http mode, hosted, and the isolate**: everything here is memory mode
  (the world) or fs mode (the browser). The content service's answers at
  size, and the 128 MB isolate with these shapes, are not measured.
- **The picker in the browser**: its list is virtualized; only its source
  read is timed.
- **A production build of the app around the Studio**: the built Studio
  above is served by `examples/tanstack` under `vite dev`, whose own 234
  unbundled modules are most of the 1k cold start.
- **Remote refs in the browser**: remote media needs the proxy-mode server's
  content host (`VAL_E2E_REMOTE_MEDIA`); the world and `scale.ts` cover
  remote.
