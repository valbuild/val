---
"@valbuild/tanstack-build": minor
---

A `PUBLIC_` variable set in Val Build now wins over the same name given at build time.

Since 0.153.0 a hosted site reads its `PUBLIC_` variables when it runs, but a value passed to `buildUserApp({ env })` (for example by `val publish` from a shell or `.env` that had it) still won. Changing that variable in Val Build then did nothing until somebody published again. Now:

- A `PUBLIC_` value given at build time is only the fallback: the runtime value wins, for `import.meta.env.NAME` and `process.env.NAME` alike, on the server and in the browser.
- Other values given at build time are still read by name only, on the server only: `const { NAME } = import.meta.env` does not find them, as in Vite.
- In the browser, `process.env` carries `NODE_ENV: "production"`, so `const { NODE_ENV } = process.env` no longer reads `undefined` and takes the development branch.
- `import.meta.env` is no longer frozen: it is one object shared by every module, as in Vite, so an assignment to it no longer throws.
