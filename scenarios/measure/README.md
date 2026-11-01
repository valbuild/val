# Measuring performance

How Val's performance is measured for `docs/plans/one-content-model.md`, and
what is and is not known about running in a Cloudflare isolate (workerd).
Written for whoever measures next: the method matters more than any one
number, because the numbers move with the code.

## The rules

1. **Measure the product's path.** The same rule as the scenarios
   (`.agent/rules.md`, test rule 3): a measurement calls the function the
   product calls. `draftRead.ts` sends the request a draft-mode `fetchVal`
   sends, to TanStack's real `initValServer` handler. `keystroke.ts` writes
   through `patchStore.createPatch`, as a field does. A benchmark of a copy
   measures the copy.
2. **Print, do not assert a stopwatch.** These scripts are not tests, like
   `searchIndex.perf.test.ts` and `draftRead.perf.test.ts` before them. A
   timing assertion is flaky on a shared CI machine and silently loose
   everywhere else.
3. **What CI checks is counted work, not time.** A budget that must hold on
   every push ("a keystroke applies one patch") is a count from the stores'
   activity channel (`RecordingActivity`), asserted in a scenario with
   `world.expectWork`. Counts are deterministic; milliseconds are not.
4. **One process per heap measurement.** Heap is measured in a child Node
   process started for that one run, so nothing earlier in the run is still
   on the heap.
5. **Say what the number is a floor or a ceiling of.** Every result below
   says how it differs from the real environment.

## The scripts

Run from `scenarios/`.

| Script                  | Measures                                                                                                              | Run                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `draftRead.ts`          | A draft read on Val's server: time, and the smallest heap it completes in                                             | `node --import tsx measure/draftRead.ts all` (long: it bisects the heap) |
|                         | One input and operation, in-process                                                                                   | `node --expose-gc --import tsx measure/draftRead.ts run synth:5 draft 5` |
| `keystroke.ts`          | One write in the Studio (what a field pays when typing pauses), by module size                                        | `node --import tsx measure/keystroke.ts`                                 |
| `evaluateValModules.ts` | Bundling a project's `val.modules` from its source and reading every module: what evaluating code after a write costs | `node --import tsx measure/evaluateValModules.ts <project root>`         |

`draftRead.ts`'s operations: `load` (modules loaded and `/stat` answered: the
baseline), `draft` (`PUT /sources/~`, validated: what a draft-mode `fetchVal`
asks on every request), `draft-novalidate` (the same without validation;
previews are still computed), `base` (unpatched and unvalidated:
BaseAlignment's fetch). Its inputs: `web` (valbuild/web), `synth:N` (about
N MB of content in 20 record modules with rich text), `synth:1+650` (1 MB
with a 650-patch chain).

## Heap, and the 128 MB isolate

**What the limit is.** A Cloudflare Worker isolate may use 128 MB,
counting the JavaScript heap AND WebAssembly memory
([Cloudflare: limits](https://developers.cloudflare.com/workers/platform/limits/index.md)).
For a hosted site the app's own code is in that same isolate, so Val gets what
the app leaves.

**How it shows when crossed.** In production: error 1102 to the client, and
the outcome `exceededMemory` in analytics, Logpush and `wrangler tail`. The
loader's tail line is `Worker exceeded memory limit`. That is how
`docs/build-assets.md` in valbuild/home found the Studio's embedded assets
costing 84-99 MB: each kill meant a new isolate, about 1.5 s, and a retry.

**What is NOT known: whether local workerd enforces it.** Neither
Cloudflare's docs nor home's (as of 2026-11-01) say that `wrangler dev` or a
local `workerd` kills an isolate at 128 MB, and this was not verified. So a
run that passes locally in workerd proves nothing about the limit. Until
someone checks, measure in one of these ways:

1. **Node, with the heap capped (what `draftRead.ts` does).** Run the
   operation in a child process with `--max-old-space-size=<MB>`, and find the
   smallest value it completes in by bisection. That caps V8's OLD generation
   only: the young generation (up to about 16-32 MB), compiled code and
   WebAssembly come on top, and the app's bundle on top of that. **So the
   result is a lower bound.** If an operation needs 100 MB of old space, it
   does not fit in an isolate. If it needs 30 MB, it may.
2. **Retained heap after an operation** (`--expose-gc`, then `gc()` and
   `v8.getHeapStatistics().used_heap_size`). That is what stays between
   requests, such as a memo or a cache. It is not the peak.
3. **A heap snapshot in workerd**: `wrangler dev`, press `D` for DevTools,
   then take Memory snapshots
   ([Cloudflare: memory usage](https://developers.cloudflare.com/workers/observability/dev-tools/memory-usage)).
   Use this for what is retained in the real runtime, not for the limit.
4. **The deployed loader**, which is the only place the limit is certain:
   `wrangler dev --remote`, or publish a probe to a deployed loader
   (`pnpm parity` in valbuild/home's `platform/` compares localhost with the
   deployed loader) and watch `wrangler tail` for `exceededMemory`. Home's
   platform README is clear that `wrangler dev` and Cloudflare differ in ways
   only the deployed one shows.

**A rule of thumb from home** (`docs/plans/upgrades-v2.md`): validating
content takes about 5× its size in memory, and in an isolate that already
holds an app, about 15 MB of content crosses 128 MB. Re-derive it before
relying on it.

## Caveats of this environment

- **valbuild/web** is loaded the way `val validate` loads a project: in
  `node:vm`, with the TypeScript compiler in the same process. That compiler is
  in the `web` baseline (`load`) and in nothing an isolate runs, so compare
  `draft` to `load` rather than reading `web`'s absolute heap. The loader
  resolves packages from the project's own folder, so `web` needs
  `@valbuild/core` and `@valbuild/next` in `web/node_modules`. Linking them to
  this repository's packages is enough (`ln -s …/val/packages/next
web/node_modules/@valbuild/next`, and the same for `core`).
- **Bundling** in `evaluateValModules.ts` uses native rolldown, as `val
publish` does. The Studio bundles with rolldown's WebAssembly build in a
  worker, which is slower, and loads that WebAssembly first. So the times are
  a floor for the browser. rolldown's WebAssembly build crashed in Node's
  worker threads under a loaded test run (`tanstack-build`'s
  `__fixtures__/nativeBundler.ts`), so do not switch these scripts to it to
  get browser numbers. Measure in a browser instead.
- **Synthetic content** has a fixed shape (strings, a two-paragraph rich text,
  a short array). Real content with deep rich text, many images or large
  `.jsonValues()` records costs differently. Use it for how cost grows, not
  for a site's exact number.

## Results

See [`results.md`](results.md). Each result says when, on what, and from which
command, so it can be re-run rather than believed.
