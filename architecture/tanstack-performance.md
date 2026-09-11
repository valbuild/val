# What Val costs a visitor who is not editing

Measured on `examples/tanstack`, production builds, Chromium, a fresh browser
context with **no `val_enable` cookie** — i.e. an ordinary visitor. The control
is the same app with Val removed: same pages, same content, read from a plain
TypeScript object instead.

Re-measure with `examples/tanstack`: build the packages (`pnpm run build`, then
`pnpm preconstruct dev` afterwards), build the example, serve it with
`vite preview`, and record every response with Playwright. Numbers taken against
`preconstruct dev` links are **not comparable** — Vite then bundles the
workspace SOURCE, and the chunk names give it away (`src-*.js`, `internal-*.js`).

## The result

| First load of `/`       | No Val (control) | With Val | Next example |
| ----------------------- | ---------------: | -------: | -----------: |
| JS transferred (gzip)   |           100 KB |   157 KB |       191 KB |
| JS transferred (raw)    |           310 KB |   551 KB |       678 KB |
| Requests to `/api/val`  |                0 |    **0** |        **0** |
| Timers started by Val   |                0 |    **0** |        **0** |
| Val elements in the DOM |                0 |        0 |            0 |

**The runtime cost is zero, and that is the part that was designed for.** A
visitor without the cookie makes no request to Val, starts no interval, mounts
no overlay and runs no polling: `mountOverlay` is the cookie, and the refresh
loop, the `/draft/stat` poll and the safety refresh are all behind it. The
Suspense gates short-circuit on `suspend`, which stays false. `createValClient`
— and the ~113 KB of zod it drags in — is behind a dynamic import that is only
reached once the overlay mounts, and the measurement confirms that chunk is
never fetched.

**The bundle cost is not zero: about +57 KB gzipped.** Nearly all of it is one
chunk, `@valbuild/core`, at 210 KB raw / 50 KB gzipped.

## Where the 50 KB comes from, and why

`@valbuild/core` is in the browser bundle because the app imports `val.config`
and its `*.val.ts` modules into client code, and both of those run `initVal()` —
the schema system. Two things pull them in, and both are deliberate:

1. **The hooks.** `useVal` / `useValRoute` resolve a selector in the browser, so
   the schema and the source have to be there. This is what makes content
   click-to-editable and what makes an edit in the Studio appear as it is typed.
2. **`ValModulesClient`.** The Studio needs the module registry, and the `def`
   entries are closures — they cannot be serialized through a loader, so the
   registry is imported into the client bundle.

This is **not** specific to TanStack Start. The Next example ships more, not
less (191 KB gzip versus 157 KB), through exactly the same route: its
`ValModulesClient` is in the root layout. Anyone comparing the two frameworks on
this number is comparing their app shells.

## What an app can do about it today

Read content in **loaders through `createServerFn`** rather than in components
(see `src/routes/_site.docs.$.tsx`). The content then arrives as plain JSON and
the page never imports the schema system — at the price of click-to-edit on that
content, which is the whole trade. A marketing site whose copy is edited in the
Studio wants the hooks; a page whose content is only ever edited in a pull
request does not.

Dropping `ValModulesClient` from a route that is not the Studio does **not** help
on its own: with the hooks in use the same modules are imported anyway.

## What Val could do about it, and what was ruled out

Measured, so it is not re-derived:

- **Removing `Internal` from the browser path does not help by itself.**
  `valEnableCookie.ts`, `cssUtils.ts` and `ValCanvasBridge.tsx` import `Internal`
  from `@valbuild/core` for a string constant, a hash and a string split — and
  `Internal` is one object literal spread across the whole module graph, so
  importing it defeats tree-shaking. Replacing all three with local
  implementations was tried and moved the number by **zero**: the app's own
  `val.config` import is what pulls core, and it dominates.
- **Passing a plain `ValConfig` object to `ValProvider`** instead of the one
  `initVal()` returns also moved it by zero, for the same reason.

So the prize is real but it is not in the provider: it is that reading content
in the browser needs the schema system, and the schema system is 50 KB. Making
that smaller means a browser-shaped subset of core — schema _resolution_ without
schema _construction_, validation, or the fix machinery — which is a project of
its own, and one that would pay off for `@valbuild/next` just as much.
