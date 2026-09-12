---
"@valbuild/server": patch
---

`next build` no longer warns `module.createRequire failed parsing argument.`

Every Next app that bundles `@valbuild/server` into its Val API route got this
on every build, twice, with an import trace that led from `route.ts` down into
`valbuild-server.esm.js` and stopped there:

```
⚠ ./node_modules/.../@valbuild/server/dist/valbuild-server.esm.js
module.createRequire failed parsing argument.
```

Nothing was wrong. webpack special-cases a `createRequire` binding imported from
`node:module` and tries to resolve the call's argument at build time; the two
calls in this package take a path inside the user's project, known only at
runtime, so there was nothing to resolve and nothing the warning could tell
anyone. Both now go through a helper that reaches the same function through the
`Module` class, which that analysis does not tag. Runtime behaviour is
unchanged, and a lint rule keeps the direct import from coming back.
