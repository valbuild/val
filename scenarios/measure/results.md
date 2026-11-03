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
everywhere except where said), "browser" the Playwright run.

| Surface                                 | 1,000                                                                                                                                                  | 10,000                                                                                                                                       | 100,000                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Cold start to the first field           | **degraded**: stores 37 ms; browser 5.0 s (dev, unbundled), longest task 450 ms; 70 MB heap                                                            | **degraded**: stores 163-300 ms; browser 6.2 s, longest task 2.1 s; 99 MB                                                                    | **broken**: browser 34 s with a 26 s freeze, 416 MB; stores 1.9-3.1 s (server start 1.3-2.5 s more)                      |
| Open the record list                    | **degraded**: 19 GET /json (the window, gated); stores 33 ms; browser 0.57 s, longest task 190 ms                                                      | **degraded**: the same 19 requests; stores 82 ms; browser 1.2 s, longest task 575 ms                                                         | **broken**: browser 35 s (with a reload), longest task 15.7 s; still 19 requests; stores 1.1 s                           |
| Scroll the record list                  | **degraded**: 9 long tasks, longest 200 ms; one GET /json per row that comes on screen                                                                 | **degraded**: 9 long tasks, longest 634 ms; the list's `scrollTop` came back to 1,500 px after 40 steps of 1,500 (not investigated)          | **broken**: browser 42 s for 40 steps, longest task 8 s                                                                  |
| Open one post                           | **fine**: under 1 ms, nothing requested (the record's reference scans name no module here)                                                             | **fine**                                                                                                                                     | **fine**                                                                                                                 |
| Keystroke in a post (stores)            | **fine**: median 1.1 ms, p90 3.6                                                                                                                       | **fine**: 2.3 ms, p90 4.6                                                                                                                    | **degraded**: 42 ms, p90 52 (the view copies the record's root of 100,000 keys per apply)                                |
| Typing on the page that picks (browser) | **degraded** (dev build) after the fix: longest task 69 ms typing 10 characters (227 ms before); its store work is the same as next to libraries of 10 | **fine** after the fix: longest task 75-124 ms (1.1 s before); the cause was four whole-project derivations per keystroke, see "After" below | **fine** after the fix: longest task 59 ms in a profiled run, 256 ms in the spec under load (a 14 s freeze before)       |
| Image library: open the gallery         | **fine** after the fix: the tiles on screen (about 35), 0.4 s; 1,000 `<img>` before                                                                    | **fine** after the fix: 0.3 s, longest task 207 ms, 28 `<img>`, 88 MB (6.9 s, 10,000 `<img>`, 212 MB before)                                 | **fine** after the fix: 0.9 s, longest task 843 ms (the items for 100,000 entries), 28 `<img>` (125 s and 1.8 GB before) |
| Image library: scroll the gallery       | **degraded** (dev build) after the fix: longest task 82-93 ms; 860 thumbnail requests (3,900 before)                                                   | **fine** after the fix: no task over 146 ms, 1,400 thumbnail requests (105 s and 9,400 before)                                               | **fine** after the fix: longest task 135 ms (the tab crashed before)                                                     |
| Open the picker (source read)           | **fine**: 0.5 ms (the list is virtualized; not driven in the browser)                                                                                  | **fine**: 1.6 ms                                                                                                                             | **fine**: 30 ms                                                                                                          |
| Pick from the library                   | **fine**: 3 ms, one patch, the field reads the ONE library entry by its path (`fillFromGallery` lookup)                                                | **fine**: 3 ms                                                                                                                               | **fine**: 4-6 ms                                                                                                         |
| `keyOf` dropdown                        | **fine** after the fix: opens in 0.1-0.2 s with the options on screen (19); 1,001 before                                                               | **fine** after the fix: 0.2-0.3 s, 19 options, longest task 96 ms (6.3 s and 10,001 before)                                                  | **fine** after the fix: 0.24 s, 19 options (did not open before); stores 75 ms                                           |
| Search, one query                       | **degraded**: loads every post first (1,000 GET /json, 0.64 MB); stores 1.3 s; browser 0.74 s to first results                                         | **degraded**: 10,000 GET /json (6.5 MB), stores 47-51 s, heap +134-190 MB; browser 14.9 s, longest task 3.3 s                                | **broken**: the process ran out of 8 GB of heap after about 200 s, loading                                               |
| Gallery: select an image ("used by")    | **degraded**: loads every post (a post can pick the image): 981 requests, 0.9 s                                                                        | **degraded**: 9,981 requests, 43.5 s (not checked in the browser whether progress is shown)                                                  | **broken**: out of 8 GB of heap, loading                                                                                 |
| Validate everything (Studio)            | **fine**: 26 ms, loaded content only (unloaded posts are not validated in the Studio)                                                                  | **fine**: 140-170 ms                                                                                                                         | **degraded**: 1.5-1.8 s                                                                                                  |
| Discard all                             | **fine**: 6 ms                                                                                                                                         | **fine**: 9 ms                                                                                                                               | **fine**: 58-102 ms                                                                                                      |
| Publish one post                        | **fine**: 77 ms; then the Studio re-reads the whole project, `PUT /sources/~`: 314 KB                                                                  | **degraded**: 223-317 ms; the re-read is 3.2 MB (7.8 MB remote)                                                                              | **degraded**: 2.0-2.8 s; the re-read is 32 MB (79 MB remote)                                                             |

Counted at every size (`scale.scenario.test.ts`, the same at 1k, 10k and
100k, local and remote): cold start makes two `/stat` and no `GET /json`,
imports no entry, clones each module once (5) and hashes 10 versions; opening
the record is 19 `GET /json` (12 KB), 19 imports, 2 preview computations; a
keystroke is one apply, `engine:clone-bytes` 40 and one version hash, one
`PUT /patches`; the `keyOf` dropdown computes one preview, naming 19 of the N
posts; validation runs `schema-validate` on 3 modules; Discard all rebuilds 2.
What grows with N is only what loads every post (N `GET /json`, N imports, about
650 bytes each) and the re-read after a publish (above).

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
once during the 10k search step.

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
- **A built Studio**: the browser runs the Studio from Vite's dev server, so
  its cold start includes about 1,100 module requests a built Studio does not
  make.
- **Remote refs in the browser**: remote media needs the proxy-mode server's
  content host (`VAL_E2E_REMOTE_MEDIA`); the world and `scale.ts` cover
  remote.
