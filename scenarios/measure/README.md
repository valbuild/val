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
| `isolateProbe.ts`       | A draft read in a Cloudflare Worker, stepped up until the isolate is killed; joins the runs with `wrangler tail`      | See "The deployed isolate probe" below                                   |

`draftReadWork.ts` holds the synthetic inputs and the requests, with nothing
from Node in it, so `draftRead.ts` and the isolate probe run the same code.

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

**Local workerd does NOT enforce it.** Checked on 2026-11-03 with the
isolate probe below (`wrangler dev`, wrangler 4.133.0, workerd
1.20260916.1): one isolate held 600 MB of heap ballast and answered 200, the
process's RSS at 1.3 GB, with no `exceededMemory` and no restart. So a run
that passes locally in workerd proves nothing about the limit. Measure in one
of these ways:

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
4. **A deployed Worker**, which is the only place the limit is certain: the
   isolate probe below, deployed, watched with `wrangler tail` for
   `exceededMemory`. Home's platform README is clear that `wrangler dev` and
   Cloudflare differ in ways only the deployed one shows. A site's isolate is
   started by home's loader (`worker_loaders`) rather than deployed on its
   own; the probe is a plain Worker, so if the two limits ever differ, load
   the probe's bundle through the loader as well.

**A rule of thumb from home** (`docs/plans/upgrades-v2.md`): validating
content takes about 5× its size in memory, and in an isolate that already
holds an app, about 15 MB of content crosses 128 MB. Re-derive it before
relying on it.

## The deployed isolate probe

`isolate/` is a Worker that runs a draft read on Val's real server and
nothing else, so the 128 MB limit can be found where Cloudflare enforces it.
Phase 6 of `docs/plans/one-content-model.md` has to fit in it ("Within
128 MB"), and its 16 MB budget for the head is a guess until this runs.

**What it runs.** Each `GET /run?input=…&op=…` builds the input, starts Val's
server in memory mode the way `@valbuild/server/browser` does
(`createInTabValFetch`: `ValServer`, the router and `ValOpsMemory` with the
browser's `ValServerPlatform`, since a Worker has no `fs`), and sends the
operation through `ValClient`, as a draft-mode `fetchVal` does. Inputs and
operations are `draftRead.ts`'s, from `draftReadWork.ts`: `synth:<MB>` of any
size, `synth:<MB>+<patches>`, and `web` (valbuild/web's modules, in the
`--env web` build only). `fresh=1` (the driver's default) drops what the
isolate held and builds the input again; otherwise the isolate keeps the last
input's modules and server between requests, as a site's isolate keeps its
bundle and (after phase 6) one runtime. `ballast=<MB>` holds that many MB of
JavaScript on the heap for the isolate's life, standing in for the app's own
heap, which Val shares the isolate with.

**What it reports, and what it cannot.** The response has the content's size,
whether the input was built by this request, the isolate's id and request
count (a new id means the last isolate is gone), and times from the isolate's
own clock. A Worker has no `performance.memory` or heap statistics, so it
cannot report memory. Memory is judged by Cloudflare: a request that takes
the isolate past 128 MB ends with error 1102 for the client and the outcome
`exceededMemory` in `wrangler tail`, and the driver steps sizes up until that
happens. **In a deployed Worker the clock only moves on I/O**, so the times in
the response may read 0 there: use the tail's `cpuTime` and `wallTime`.

**The code counts too.** The bundle is in the same 128 MB, so it is printed
with every build. As of 2026-11-03 it is 2.0 MB (0.4 MB gzipped). It was
12.9 MB until the TypeScript compiler (10.8 MB) left the server's browser
graph: it reaches the server through `ValServerPlatform.typescript`, which
the browser platform this probe runs on does not have. See `results.md`.

### Locally

Wrangler is not a dependency of this repository (workerd is a 100 MB binary
with an install script, which `onlyBuiltDependencies` would refuse); it runs
through `pnpm dlx`, at the version valbuild/home's loader uses. From
`scenarios/measure/isolate/`:

```bash
W="pnpm dlx wrangler@4.133.0"
export WRANGLER_SEND_METRICS=false

# Build only, and say what the bundle is made of:
$W deploy --dry-run --env "" --outdir /tmp/probe-dist --metafile
(cd ../.. && pnpm exec tsx measure/isolateProbe.ts bundle --metafile /tmp/probe-dist/bundle-meta.json)

# Serve it in local workerd, and drive it (from scenarios/, in another shell):
$W dev --env "" --port 8790
pnpm exec tsx measure/isolateProbe.ts run --url http://127.0.0.1:8790 --out /tmp/local.jsonl
```

`--env web` builds the same probe with valbuild/web's modules, from a
checkout beside this repository (`../web`; the alias is in
`wrangler.jsonc`), with `@valbuild/next` replaced by `isolate/webNext.ts`:
core's `initVal` plus the two routers, which is all of `@valbuild/next` a
`.val.ts` file uses. It needs `@valbuild/core` resolvable from web's
`node_modules`, as `draftRead.ts` does (see Caveats).

A local run proves the probe works and gives workerd's times. It says
nothing about the limit: local workerd does not enforce it (above).

### Deployed

Needs, once:

- **A Workers Paid account.** The Free plan's CPU limit is 10 ms a request,
  so every step would end `exceededCpu` before memory is reached, and
  `limits.cpu_ms` in `wrangler.jsonc` is a Standard usage model setting.
- **A workers.dev subdomain** on the account (Workers & Pages, in the
  dashboard). The probe is served at
  `https://val-isolate-probe.<subdomain>.workers.dev`, and the web build at
  `https://val-isolate-probe-web.<subdomain>.workers.dev`.
- **An API token** with, at least: Account / Workers Scripts / Edit (upload,
  workers.dev, delete) and Account / Workers Tail / Read (`wrangler tail`).
  Account / Account Settings / Read is in Cloudflare's "Edit Cloudflare
  Workers" template, which also works; User / User Details / Read and
  Memberships / Read are only needed when `CLOUDFLARE_ACCOUNT_ID` is unset.
- **The network** must reach `api.cloudflare.com` (deploy, and creating the
  tail), the probe's own `*.workers.dev` hosts (the driver), and the tail's
  WebSocket, whose URL the API hands back when the tail is created (wrangler
  `createTail`: `POST /accounts/<id>/workers/scripts/<name>/tails`, then a
  WebSocket to the returned `url`; Cloudflare's tail host has been
  `tail.developers.workers.dev`). `registry.npmjs.org` for `pnpm dlx`.
  `sparrow.cloudflare.com` is wrangler's telemetry; `WRANGLER_SEND_METRICS=false`
  keeps it off. Node's `fetch` uses `HTTPS_PROXY` only with
  `NODE_USE_ENV_PROXY=1`.

Then, from `scenarios/measure/isolate/`:

```bash
export CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… WRANGLER_SEND_METRICS=false
W="pnpm dlx wrangler@4.133.0"
$W deploy --env ""                    # prints the probe's URL; --env web for the web build

# The tail, open BEFORE the driver starts. It prints one indented JSON object
# per request; wait for a `curl <URL>/` to show up in the file before going on.
$W tail val-isolate-probe --format json > /tmp/tail.json &

# From scenarios/: the ladder (1 to 80 MB, every operation, then 1 MB + 650
# patches), then the same with 32 and 64 MB of ballast for the app's heap.
NODE_USE_ENV_PROXY=1 pnpm exec tsx measure/isolateProbe.ts run \
  --url https://val-isolate-probe.<subdomain>.workers.dev --label deployed --out /tmp/runs.jsonl
NODE_USE_ENV_PROXY=1 pnpm exec tsx measure/isolateProbe.ts run \
  --url https://val-isolate-probe.<subdomain>.workers.dev --label ballast32 --ballast 32 --out /tmp/runs.jsonl
NODE_USE_ENV_PROXY=1 pnpm exec tsx measure/isolateProbe.ts run \
  --url https://val-isolate-probe.<subdomain>.workers.dev --label ballast64 --ballast 64 --out /tmp/runs.jsonl

# Give the tail ten seconds to catch up, stop it, and join the two:
kill %1
pnpm exec tsx measure/isolateProbe.ts summarize --runs /tmp/runs.jsonl --tail /tmp/tail.json

$W delete --env ""                    # when done; the probe answers anyone
```

`--inputs` narrows the ladder (`--inputs synth:12,synth:14,synth:16` to
bisect between the last pass and the first kill), and `--ops draft` to one
operation. An operation stops climbing after two failed sizes in a row; each
failure is retried once, because the request after a kill gets a new isolate.

**Reading the result.** The summary is a Markdown table, one row per request,
with the tail's outcome, `cpuTime` and `wallTime` beside the probe's answer.
For each operation the number is the largest content that passed and the
smallest that ended `exceededMemory` (at each ballast). Put the table, the
bundle's size and the date, account plan and wrangler version in
`results.md` under "The deployed isolate". A 1102 without `exceededMemory` in
the tail is not a memory result (the tail may have missed it; re-run the
step). The probe answers anyone who has its URL, and holds nothing; delete it
when done.

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
