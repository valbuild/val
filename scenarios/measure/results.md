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
