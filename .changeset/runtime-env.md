---
"@valbuild/tanstack-build": minor
---

A hosted project's `PUBLIC_` variables are read when the page runs, not when it is built.

Variables set for a project in Val Build reach a published site without a rebuild, and `import.meta.env` reads them:

```tsx
const api = import.meta.env.PUBLIC_API_URL; // on the server and in the browser
const token = process.env.STRIPE_KEY; // a secret: on the server only
```

- In the browser, `import.meta.env` reads the `PUBLIC_` variables the platform writes into the page. On the server it reads them from `process.env`, at the top level of a module too.
- `import.meta.env` holds `PUBLIC_` names and Vite's built-ins, as in Vite. Other names are read with `process.env.NAME` on the server, and are `undefined` in the browser, where `process.env.NAME` no longer throws.
- Vite's built-ins (`MODE`, `DEV`, `PROD`, `SSR`, `BASE_URL`) are still inlined, so `import.meta.env.DEV && <Debug />` is still removed from a build.
- A `PUBLIC_` value passed to `buildUserApp({ env })` is now the fallback: a value set at runtime wins, so a variable changed in Val Build changes what the site reads. Other values passed there are still inlined, on the server only.
- `import.meta.env` is no longer frozen, as in Vite.
