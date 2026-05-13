---
"@valbuild/server": patch
---

Make the internal `typescript` import bundler-opaque (via `node:module`'s `createRequire`). This prevents webpack and Turbopack from tracing into TypeScript's `lib/typescript.js` and emitting "Can't resolve 'source-map-support'" warnings when consumers build Next.js apps that depend on `@valbuild/server` (directly or via `@valbuild/next`). No runtime or API changes.
