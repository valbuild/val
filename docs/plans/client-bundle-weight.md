# Slimming what Val ships to the browser

A production site that uses Val puts **~288 KB of Val JavaScript** in the
initial bundle of every page, for visitors who will never open the Studio.
This is what that is made of, why tree-shaking does not touch it, and which
cut is worth making.

Measured on `valbuild/web` (val.build), Next 16.3.3, webpack, production
build, landing page. Chunks were attributed by building with
`productionBrowserSourceMaps: true` and reading each chunk's source map.

## What is actually shipped

The landing page's critical JS is 915 KB. Val's share:

| Bytes (minified) | Chunk maps to                               | Why it is reachable                               |
| ---------------- | ------------------------------------------- | ------------------------------------------------- |
| 155 KB           | `@valbuild/core/dist/index-5fe6fb98.esm.js` | any import from `@valbuild/core`                  |
| 113 KB           | `zod`                                       | `@valbuild/shared/internal`, via `@valbuild/next` |
| ~20 KB           | `@valbuild/next`                            | `ValProvider`, `ValRichText`, `useVal`            |

For comparison, the framework costs 236 KB (Next router) + 196 KB (React DOM).
Val is the third-largest thing on the page and the largest thing that is not a
framework.

The 155 KB is not richtext rendering. It is the whole of core: the `Schema`
class hierarchy with `executeValidate`, `executeCustomValidateFunctions`,
`executeAssert` and `executeSerialize`, plus the MIME-type tables that
`s.file()`'s `accept` is checked against — 535 occurrences of `application/…`,
including `opendocument` and `macroEnabled` variants. None of it runs for a
visitor without the Val Enable cookie.

## Three things that are NOT the cause

Each of these was measured, not reasoned about, and each was wrong:

1. **"Lazy-load `ValProvider`."** Removing `ValProvider` and
   `ValModulesClient` from the app's root layout entirely — not deferring
   them, deleting them — moved the landing page from 1,370,543 to 1,368,918
   bytes. **1.6 KB.** The provider is not what pulls core in; `ValRichText` is,
   and it renders actual page content, so it cannot be deferred.

2. **"The overlay ships even though it never mounts."** True but nearly free.
   `ValNextProvider` gates the overlay on `mountOverlay`, and the Studio SPA
   itself is served separately from `/api/val/static/…`, so it is not in the
   app bundle.

3. **"Set `sideEffects: false`."** `@valbuild/next` declares
   `"sideEffects": true` and core and shared leave it unset, which does look
   like the bug. Patching all three to `false` in `node_modules` and
   rebuilding changed the landing page by **177 bytes**. It cannot work — see
   below.

## Why tree-shaking cannot help

`@valbuild/core`'s published `dist` is not a module graph. Preconstruct
bundles the entire package into one file:

```
dist/valbuild-core.esm.js        1 KB   ← re-export shim
dist/index-5fe6fb98.esm.js     407 KB   ← everything
```

The shim is `export { A as ArraySchema, B as BooleanSchema, … }` pointing at
the one big module. Webpack sees a single module with no internal boundaries,
so there is nothing to shake along: importing `Internal` — which
`stegaEncode`, `attrs`, `cssUtils` and `valEnableCookie` all genuinely need —
takes the validation engine and the MIME tables with it. `sideEffects` only
lets a bundler drop _modules_ it can prove are unused, and here there is only
one.

`Internal` compounds it. It is a single object literal holding ~40 functions
(`mediaUrl`, `resolvePath`, `nextAppRouter`, `remote.getValidationHash`,
`validate`, …). Even with a real module graph, a bundler cannot drop
properties off an object that is exported whole.

The same shape produces the zod cost. Client code in `@valbuild/next` reaches
into `@valbuild/shared/internal` for `VAL_SESSION_COOKIE`,
`VAL_CONFIG_SESSION_STORAGE_KEY`, `VAL_THEME_SESSION_STORAGE_KEY`,
`isValCanvasFrame` and `createValClient`. Three of those are **string
constants**. That entrypoint also contains `ApiRoutes.ts`, which builds zod
schemas for the entire API surface — so importing a string constant costs
113 KB of zod.

## The two candidate cuts

### A. Split validation off `Schema` in `@valbuild/core`

Reclaims the most (up to 155 KB) and fixes it for every consumer, not just
Next. It also asks for surgery on core's most load-bearing types: every schema
class would have to keep its shape and serialization while its `executeValidate`
/ `executeCustomValidateFunctions` / `executeAssert` moved behind a separate
entrypoint that the CLI, the server and the Studio import and the browser does
not.

The risk is that the split is not clean. `Internal.validate` calls
`getSchema(val)["executeValidate"]`, `stegaEncode` switches on
`Serialized*Schema` variants, and the remote-file helpers compute validation
hashes from schemas. Each of those has to land on one side of the line.

### B. A render-only client entrypoint in `@valbuild/next`

Ship `@valbuild/next/render` (or similar) exporting only `ValRichText`,
`ValImage` and the stega readers, importing nothing that reaches the Schema
classes. Much smaller blast radius, no core churn, additive and non-breaking.

But it cannot work on its own, and this is the point: as long as core is one
bundled module, a render-only entry that touches `Internal` for `mediaUrl` or
`resolvePath` still drags in all 407 KB. **B is downstream of A.**

## Recommendation

**Start with `@valbuild/shared/internal` (2). It is the one to do first.**

It is worth 113 KB, it is independent of everything else here, and it is a
file move rather than a redesign: pull the string constants and
`isValCanvasFrame` out of the entrypoint that carries `ApiRoutes.ts`, so
client code can import `VAL_SESSION_COOKIE` without importing zod. Of the
three cuts it has by far the best ratio of bytes reclaimed to risk taken, and
nothing else has to land first.

Then, if the remaining 155 KB justifies it:

1. **Give `@valbuild/core` real module boundaries.** Add preconstruct
   entrypoints — the package already does this for `./fp` and `./patch`, so
   the mechanism is in place and the release plumbing already understands it.
   The first cut worth trying is `@valbuild/core/schema` (classes, shapes,
   serialization) versus the validation machinery, with `Internal` broken into
   the handful of namespaces consumers actually use rather than one object.

   Even before validation is split out, simply _having_ boundaries lets
   `sideEffects: false` start working, which is currently a no-op. Set
   `sideEffects` correctly across core, next and shared as part of this step —
   not before, where it measures as noise and reads as a fix that did not work.

2. **Then add the render-only `@valbuild/next` entry**, which can only be
   narrow once core has boundaries.

Cut (A) is the big one but it is surgery on core's most load-bearing types, and
(B) cannot pay off before it. Neither should block shipping the shared fix.

## How to verify a change

Do not trust the route table or a byte count from `next build`; measure what a
browser downloads.

```bash
# in the consuming app
# next.config.js: productionBrowserSourceMaps: true
pnpm run build && pnpm run start
```

Then load the page and attribute every chunk in the critical path back to its
sources through its `.js.map` — `sources` plus `sourcesContent` lengths gives a
per-file breakdown. Split "before the load event" from "after" so route
prefetches are not counted as critical.

The number to move is **critical JS attributed to `@valbuild/*` and its
dependencies**, currently ~288 KB. Total blocking time on a 4x-throttled CPU is
the user-visible consequence and the better headline, but it is noisier; use
bytes to know whether a cut landed and TBT to know whether it mattered.

## What this is not

Prerendering. A separate finding on the same site: one `cookies()` call in the
root layout opted every route out of static generation. That is an application
bug, not a Val one — `fetchVal` does no network call unless draft mode is on,
and `draftMode()` does not itself force dynamic rendering in Next 16. Fixed in
`valbuild/web#23`; noted here only because the two get confused.
