---
"@valbuild/tanstack": minor
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/ui": minor
"@valbuild/next": patch
"@valbuild/mcp": patch
"@valbuild/language-server": patch
---

Val now runs on TanStack Start.

`@valbuild/tanstack` is a new package with everything `@valbuild/next` has: Val
Studio at `/val`, the on-page overlay and canvas, draft mode, the client hooks,
server-side content reads, images, and the MCP tools.

```sh
npm install @valbuild/tanstack
```

```ts
// val.config.ts
import { initVal } from "@valbuild/tanstack";
const { s, c, config, tanstackRouter } = initVal({ project: "org/project" });
```

**Routes are first class.** A Val module for a route is named after the route
file it sits beside — `src/routes/posts.$postId.tsx` is served content by
`src/routes/posts.$postId.val.ts` — and its keys are the URLs that route serves:

```ts
export default c.define(
  "/src/routes/posts.$postId.val.ts",
  s.router(tanstackRouter, s.object({ title: s.string() })),
  { "/posts/hello-world": { title: "Hello world" } },
);
```

`.` and `/` both separate segments, `$param` is a parameter, `$` is a splat, and
`index`, `route`, `(groups)` and `_pathless` layouts add no URL segment — the
same rules TanStack Router uses for the route file itself. Val validates every
key against that pattern, and Val Studio shows these modules as a sitemap under
**Pages**, where an editor can add a page.

Point the route generator away from your content files, in `vite.config.ts` and
`tsr.config.json`:

```ts
tanstackStart({ router: { routeFileIgnorePattern: "\\.val\\.[tj]sx?$" } });
```

See the [README](https://github.com/valbuild/val/blob/main/packages/tanstack/README.md)
for the full wiring, and `examples/tanstack` for a working app.

**Also fixed, for everyone:** `Internal.VERSION.core` was `null` in any ESM
bundle — it was read with `require("../package.json")` inside a `try`, so the
failure was silent. That version goes into every remote file ref and proxy mode
refuses to start without it. Every package now reads its version through a
static JSON import, which is inlined at build time.
