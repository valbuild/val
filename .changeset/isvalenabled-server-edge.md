---
"@valbuild/tanstack": patch
---

`@valbuild/tanstack` can be bundled for a browser again

The root entry — the one every client component imports — reached TanStack
Start's server module from inside `isValEnabled`:

```js
const { getCookie } = await import("@tanstack/react-start/server");
```

At runtime that is already correct anywhere but a server: the import fails, the
`catch` returns `false`, which is what the function's documentation says it does.
Under Vite the dynamic form also keeps it out of the client bundle.

It does not everywhere. A host that bundles this package ahead of time and audits
what each chunk imports sees a dynamically imported chunk as a chunk like any
other — and this one reaches Start's SSR path and lands on `node:stream`. The
package could not be built for a browser or a Cloudflare Worker at all, which
made every component importing it unusable there.

The edge is now inverted. The root entry holds a slot, `@valbuild/tanstack/server`
fills it on import with the implementation that was already there, and the root
entry no longer names TanStack's server module. Nothing changes for an app that
imports `/server`, which is every app with a Val API. An `isValEnabled()` call
before `/server` is first imported returns `false` — the same answer the old
implementation's `catch` gave in that situation.
