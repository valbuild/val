---
"@valbuild/ui": minor
"@valbuild/core": minor
"@valbuild/server": minor
"@valbuild/shared": minor
---

The Studio can load a bundler, and it stops telling a managed project that its
publish is on its way out.

**A managed project is one with no repository and no host watching one.** There
is nothing outside the browser to pick a commit up, so the Studio has been
showing it a story that belongs to a project with a repository: a `Building`
spinner, waiting for an event that can never arrive. It does not resolve on a
reload, on a retry, or tomorrow, and there is no way to tell it from a deploy
that is merely slow.

The content service now reports which kind of project this is, as `sourceMode`
on `/stat`, and the Studio narrates accordingly:

- a **connected** project keeps the deploy feed and keeps `Building`, because
  there a host genuinely does pick the commit up;
- a **managed** one says `Saved, not yet live` instead — a durable condition,
  not a phase, because nothing else will ever resolve it.

A server that reports no source mode keeps the behaviour it has today. Absence
means "not reported", never "managed": `fs` mode has no project to have a mode,
and neither does a content service that predates the field.

**The Studio also loads `@valbuild/tanstack-build` in the tab**, at mount and at
idle, for the managed projects that will need it — a browser that is the
deployer needs a bundler. This is the groundwork for browser-side publishing;
the publish path itself is unchanged in this release.

That bundler is `@rolldown/browser`, whose WebAssembly binary is 10.9 MB and is
**not** in the npm package. It is served from `static.val.build`, addressed by
the SHA-256 of its own bytes, so the build and the binary it needs cannot drift
apart. A deployment that must not reach that host — an air-gapped install, a
mirror — sets `globalThis.__VAL_ROLLDOWN_WASM_URL__` before the Studio loads and
needs no rebuild.
