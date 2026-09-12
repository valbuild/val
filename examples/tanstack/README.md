# Val + TanStack Start example

The smallest app that exercises the whole of `@valbuild/tanstack`: a static
page, a dynamic route, a splat route, a plain content module, an image, and Val
Studio at `/val`.

## Running it

Val Studio's own bundle is served by the `@valbuild/ui` dev server in this
repository, so run both:

```bash
pnpm run dev:example-tanstack     # from the repo root
```

Then open http://localhost:3457, and http://localhost:3457/val for the Studio.
Nothing is editable until Val is enabled for your browser:

```
http://localhost:3457/api/val/enable?redirect_to=/
```

## What is where

| File                                     | What it shows                                          |
| ---------------------------------------- | ------------------------------------------------------ |
| `src/routes/_site.tsx`                   | `ValProvider` + the Suspense boundary `suspend` needs  |
| `src/routes/_site.index.val.ts`          | a route module for the index route                     |
| `src/routes/_site.posts.$postId.*`       | a dynamic route, read with `useValRoute`               |
| `src/routes/_site.docs.$.*`              | a splat route, read on the server via `createServerFn` |
| `src/routes/val/`                        | Val Studio, outside the site's layout                  |
| `src/routes/api/val.$.ts`                | the Val API                                            |
| `src/val/client.ts`, `src/val/server.ts` | the two halves of the wiring                           |
| `vite.config.ts`, `tsr.config.json`      | `routeFileIgnorePattern`, so `*.val.ts` is not a route |

The site's pages sit under the pathless `_site` layout so that the Studio route
does not inherit the site's chrome — the same reason the Next example puts its
pages in a `(main)` group.
