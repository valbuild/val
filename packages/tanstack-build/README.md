# @valbuild/tanstack-build

Builds a TanStack Start app from a Val project's files — in the browser for the
Studio, and in Node for a publisher with a checkout.

```ts
import {
  buildUserApp,
  fetchBuildTarget,
  wireUp,
} from "@valbuild/tanstack-build";
```

## What is in here

Three things that used to be three packages in `valbuild/home`, and are one
package because they are one decision — what a published build IS.

- **The build.** `buildUserApp(input)` takes a project's files and a
  `BuildTarget` and produces the server, client and (optionally) RSC bundles,
  the CSS, the assets and the chunk map. It runs on `@rolldown/browser`, so it
  runs in a tab.
- **The wiring.** `wireUp(files, options)` turns an imported checkout into
  something a host with no filesystem can serve: it writes the project's
  `src/val/val.server.ts` against `@valbuild/tanstack/server`. That file is the
  reason this package lives in this repository — see below.
- **The contract.** `BuildTarget`, `UserApp`, `PublishManifest`: the types the
  platform and the build agree on. Types only, so a user's app never needs a
  runtime import from the platform.

## The two entrypoints

| Entrypoint                      | Runs where                   | Holds                                                            |
| ------------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `@valbuild/tanstack-build`      | anywhere — tab, Worker, Node | the build, the wiring, the contract, the git tree hash           |
| `@valbuild/tanstack-build/node` | Node only                    | the dependency layer, the route tree, `@plugin`, route splitting |

The split is not organisational. `@valbuild/ui` imports the root so the Studio
can build a project in the tab, and the `/node` half reaches `node:` builtins,
`rolldown` and `@tanstack/router-generator` — a browser bundle that pulls any of
them fails in the consuming app's build, with a message about a polyfill, a long
way from here. `src/noNodeFromBrowser.test.ts` walks the root's import graph and
fails if anything under `src/node/` becomes reachable from it.

The `/node` half's heavy dependencies are **optional peers**. A project that only
builds in the browser installs neither; a publisher that builds a dependency
layer already has `rolldown`, and one that wants `autoCodeSplitting` already has
`@tanstack/router-plugin`, because both are things the project asks for.

## Why it lives in this repository

`wireUp` writes code against `initValServer`'s signature. It used to do that
from another repository on another release train, so a change to that signature
could not break it until somebody published — which is to say the break was
found by a user. It is now beside the function it calls.

The build could move because it had already stopped importing the platform's
vendor package: it takes a `BuildTarget` as a parameter instead, so the facts
about which specifiers are externalised and where their chunks live **arrive**
rather than being compiled in. The same change is what lets the Studio carry a
builder at all.

## The platform is a parameter, never an import

Two calls take facts about the host rather than reaching for them:

- `buildUserApp({ target, … })` takes a `BuildTarget`, fetched with
  `fetchBuildTarget({ loader, project, token })`.
- `buildVendorLayer(dir, deps, css, platform)` takes a `VendorPlatform`: the
  same `BuildTarget.base`, plus the two things that cannot cross a wire — where
  the platform's own copy of a package is, and where its built base-layer chunks
  are. A host with neither passes `() => null` and `null`, and says so by doing
  it.

## Regenerating the Tailwind sources

`src/tailwindSources.gen.ts` is Tailwind's own stylesheets, inlined, because the
build has no filesystem in either place it runs. Regenerate it when
`tailwindcss` is bumped and at no other time:

```bash
pnpm --filter @valbuild/tanstack-build build:tailwind
```
