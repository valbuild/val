---
"@valbuild/core": minor
"@valbuild/ui": minor
"@valbuild/server": patch
---

Replace `ValSyncEngine` with event-driven stores

`ValSyncEngine.ts` — 5528 lines, one class, 31 hand-maintained snapshot caches — is
deleted, along with its test and the engine-era helper layer
(`ValidationWorkerClient`, `createValidationWorker`, `mergePatches`,
`yieldToBackground`, the `stores/react/use*` hooks). Every hook the Studio renders
through now runs on ten stores across two realms: a change _marks_, and demand
_computes_.

Measured on the `screen` fixture (141 modules, 16 mounted fields), median of 11
reps: intake 51.7ms → 6.2ms, mount 10.3ms → 0.3ms, keystroke 10.6ms → 0.4ms,
React re-renders per keystroke 16 → 0, retained heap 3717KB → 2263KB. The
`nested-row` case ran 650 `select` closures to put one row on screen and now runs
2, because the engine's finest render was per module.

**Breaking, in `@valbuild/core`:** `ListArrayRender.items` is now `[index, value][]`
rather than `value[]`. A windowed render is a _shorter_ array than the list it came
from, so `items[i]` silently read the wrong row; carrying the index makes that
unrepresentable. Renders are also path-scoped now, which threads a new
`RenderScope` (exported) through `executeRender`, and `SerializedSchema` carries
`render?: true` so a module declaring no render is not walked at all.

`@valbuild/server` gains jsonValues entry validation and a fix to patch file
uploads: `ValOpsFS` wrote a patch's bytes into the directory named by its
`parentRef` and read them back out of the directory the patch landed in, so every
upload after the first 404'd.
