---
"@valbuild/tanstack-build": minor
---

New package: `@valbuild/tanstack-build` builds a TanStack Start app from a Val
project's files — in the browser, and in Node.

It carries three things that were previously in the platform repository:

- **the build** — `buildUserApp(input)` produces the server, client and RSC
  bundles, the CSS, the assets and the chunk map, on `@rolldown/browser`, so it
  runs in a tab;
- **the wiring** — `wireUp(files, options)` writes a project's
  `src/val/val.server.ts` against `@valbuild/tanstack/server`;
- **the contract** — `BuildTarget`, `UserApp`, `PublishManifest` and the rest of
  the types a host and a build have to agree on.

The wiring is the reason for the move rather than a passenger of it. It writes
code against `initValServer`'s signature, and it used to do that from another
repository on another release train — so a change to that signature could not
break it until somebody published, which is to say a user found it. It is now
beside the function it calls.

Everything that needs Node is behind the `@valbuild/tanstack-build/node`
subpath: the project dependency layer, the route tree, Tailwind's `@plugin` and
`autoCodeSplitting`. The root entrypoint reaches none of it, and a test walks
the import graph to keep that true — a browser bundle that pulled in `rolldown`
or a `node:` builtin would fail in the consuming app's build rather than here.
`rolldown`, `@tanstack/router-generator` and `@tanstack/router-plugin` are
optional peer dependencies for the same reason: they are things a project asks
for.

Type-checking this code for the first time, and reviewing it once it was here,
found several things that had been invisible where it lived — that build strips
types rather than checking them, and its one check of the generated server file
runs `tsc --noResolve`, so it cannot see across an import at all.

The one that mattered most is about a rename that has gone both ways.
`ValHttpMode` took `gitCommit`/`gitBranch` up to 0.132, a nested `git` from
0.133.0, and is flat again here — and the generated `val.server.ts` is compiled
and run against whatever `@valbuild/tanstack` the PROJECT installed, which the
platform writing the file has no say in. Sending only the name this release
knows drops the commit for every app still on 0.133.x, silently: the publish
then produces no mirrored `.val.ts`, so a save commits and hands over nothing,
and the site keeps serving its old content with the patches already consumed.
The template now sends all three keys, and each version reads its own and
ignores the rest.

There is also a test that compiles the generated file against the real package,
with resolution — the platform's own check runs `tsc --noResolve`, so it cannot
see across an import at all. It is the right tool for a name that no longer
exists and the wrong one for this, and it says so: the compiler in this
repository is looking at a different version of `@valbuild/tanstack` than the
app is.

Two more, both of which changed behaviour:

- A split route's deferred half skipped every source transform, so
  `<ClientOnly>` and `createIsomorphicFn()` in a route component were rewritten
  when no splitter was supplied and left alone when one was. Splitting is
  allowed to cost bytes and not to change behaviour.
- The project dependency-layer build re-audited chunks it had just dropped,
  because its fast path and its retry shared an output directory that nothing
  cleared — so the recovery failed for exactly the case it exists for.

And the four the compiler found on its own:

- Tailwind's `loadModule` contract was restated by hand and restated wrongly —
  Tailwind also wants a `path`, and the CLI's loader had never sent one. The
  type is now derived from Tailwind's own option, so an upgrade that changes the
  shape is a compile error rather than an `undefined` handed to someone else's
  code.
- The rolldown output filter was `(chunk: any) => chunk.type === 'chunk'`, which
  does not narrow, so every `.code` read after it was unchecked.
- The route generator was handed `verboseFileRoutes: true`, a key that is not in
  its config, its types, or anywhere in its dist — inert, behind an `as any`.
- The same cast was hiding a key the generator does require. Both are gone, and
  so is the cast.
