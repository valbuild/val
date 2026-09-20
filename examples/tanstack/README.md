# Val + TanStack Start example

The app that exercises the whole of `@valbuild/tanstack` — a static page, a
dynamic route, a splat route, plain content modules, media and Val Studio at
`/val` — and the SHOWCASE for the schema system: every `s.*` type and every
schema modifier is meant to be visible here, working, in an app that really
builds and really validates.

TanStack Start is Val's primary release target, so this is where a new schema
feature is shown first. Adding one includes adding it here: a module or a field,
registered in `val.modules.ts`, rendered by a route, and passing `val validate`.
`examples/next` is the fixture app for the e2e suite and the language server,
and carries awkward shapes this one deliberately does not.

## Running it

Val Studio's own bundle is served by the `@valbuild/ui` dev server in this
repository, so run both:

```bash
pnpm run dev:example-tanstack     # from the repo root
```

Then open http://localhost:3458, and http://localhost:3458/val for the Studio.

(3458 rather than something rounder because `e2e/http/config.ts` runs the
proxy-mode copy of the Next example on 3457, and the e2e suite starts this app
alongside it. `e2e/tanstack/config.ts` is where the port is written down for
the tests.)
Nothing is editable until Val is enabled for your browser:

```
http://localhost:3458/api/val/enable?redirect_to=/
```

## What is where

### The wiring

| File                                     | What it shows                                          |
| ---------------------------------------- | ------------------------------------------------------ |
| `src/routes/_site.tsx`                   | `ValProvider` + the Suspense boundary `suspend` needs  |
| `src/routes/_site.index.val.ts`          | a route module for the index route                     |
| `src/routes/_site.posts.$postId.*`       | a dynamic route, read with `useValRoute`               |
| `src/routes/_site.docs.$.*`              | a splat route, read on the server via `createServerFn` |
| `src/routes/_site.showcase.*`            | every other content module, rendered on one page       |
| `src/routes/val/`                        | Val Studio, outside the site's layout                  |
| `src/routes/api/val.$.ts`                | the Val API                                            |
| `src/val/client.ts`, `src/val/server.ts` | the two halves of the wiring                           |
| `vite.config.ts`, `tsr.config.json`      | `routeFileIgnorePattern`, so `*.val.ts` is not a route |

### The schema showcase

| Module                          | What it shows                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings.val.ts`               | `s.settings()`: `locales`, `theme`, `assistant`. At the root, one per project                                                                                                       |
| `src/content/site.val.ts`       | `s.object`, `s.array` of inline-rendered objects, `s.route()`                                                                                                                       |
| `src/content/authors.val.ts`    | `s.record(key, item)` with a described KEY, `.preview()`, `.validate()`, `s.enum`, `s.date`                                                                                         |
| `src/content/theme.val.ts`      | `s.color()` in hsl / hex / rgb / oklch, with alpha and nullable                                                                                                                     |
| `src/content/gallery.val.ts`    | `s.imageset()`: a collection that owns the metadata                                                                                                                                 |
| `src/content/downloads.val.ts`  | `s.fileset()`: the same, for files that are not images                                                                                                                              |
| `src/content/media.val.ts`      | `s.image()` / `s.file()` fields, plain and gallery-backed, with `dir`, `accept` and `encode`                                                                                        |
| `src/content/links.val.ts`      | `externalPageRouter`: pages that are not in this app                                                                                                                                |
| `src/content/kb.val.ts`         | `.jsonValues()` + `c.json()`: one file per entry, `s.keyOf`, `s.route().include()`, `.multiline()`                                                                                  |
| `src/content/translated.val.ts` | `s.locale()`, both ways: a locale-keyed record and a locale field                                                                                                                   |
| `src/content/access.val.ts`     | `.readonly()` and `.hidden()`, which only the Studio enforces                                                                                                                       |
| `src/routes/_site.index.val.ts` | the page-builder shapes: `s.discriminatedUnion` in an array, `.render({ as: "inline" })`, `s.code`, `s.datetime`, `s.number().min().max()`, `s.richtext` with `a` and `img` schemas |

Not shown, and deliberately: `.remote()` on media and `.external()` on a record.
Both need credentials or an adapter a plain `pnpm dev` does not have, and a
remote schema anywhere in a project makes the Studio ask for a project id and a
bucket on every publish. `examples/next` gates the remote case behind
`NEXT_PUBLIC_VAL_EXAMPLE_REMOTE_MEDIA`.

The site's pages sit under the pathless `_site` layout so that the Studio route
does not inherit the site's chrome — the same reason the Next example puts its
pages in a `(main)` group.
