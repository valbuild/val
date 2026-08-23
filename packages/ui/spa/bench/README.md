# Browser benchmark: stores vs `ValSyncEngine`

```bash
node packages/ui/spa/bench/run.mjs                       # small + large, 5 reps
node packages/ui/spa/bench/run.mjs --reps 9 --size large
node packages/ui/spa/bench/run.mjs --json /tmp/bench.json # keep the raw samples
```

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

The project is synthetic because the claim under test is about how cost scales
with project size, and a single real project gives one point. It includes the
case that actually hurts: `select` at two nested array levels, which is the
`handboka` shape named throughout the architecture notes.

## What is deliberately not measured

- **`PUT /patches`.** Unwired in the stores. The engine does that work and the
  stores do not, so every scenario stops before the sync and the engine is not
  charged for it.
- **React.** No component tree in either driver. Reconciliation would land in
  every measurement and it is the same React on both sides.
- **HTTP.** Same server for both; it would only add noise.
- **Memory.** Worth doing and not done. The engine holds ~30 hand-enumerated
  snapshot caches, so it is a fair question — this harness cannot answer it.

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
