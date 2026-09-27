---
"@valbuild/tanstack-build": patch
---

Sites published in app mode are now built the way `vite build` builds them:

- **TanStack Devtools are removed.** `@tanstack/react-devtools` has no production switch; `vite build` drops it only because the `devtools()` plugin in `vite.config.ts` strips it from your source, and app mode does not run Vite plugins. So a project that renders `<TanStackDevtools>` unconditionally, as the starter template does, showed the devtools panel on its published site. The builder now does the same stripping itself.
- **`import.meta.env.DEV`, `PROD`, `MODE`, `SSR` and `BASE_URL` are defined**, and `process.env.NODE_ENV` is `"production"` in your own code. Before, `import.meta.env.PROD` read `undefined` and `process.env.NODE_ENV` read `"development"`.
