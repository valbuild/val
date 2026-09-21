---
"@valbuild/core": patch
"@valbuild/server": patch
---

Fix `gitCommit` and `gitBranch` in `val.config.ts` never reaching the server.

`val.config.ts` has had `gitCommit` and `gitBranch` for as long as it has had
anything, and a deployed app that set them resolved to no repository at all.
Nothing failed and nothing was logged: the commit was simply never sent, and
every patch the project saved recorded none.

```ts
// val.config.ts — the normal Vercel shape, and it did nothing
initVal({
  project: "org/project",
  gitCommit: process.env.VERCEL_GIT_COMMIT_SHA,
  gitBranch: process.env.VERCEL_GIT_COMMIT_REF,
});
```

The two halves never met. `initHandlerOptions` reads a NESTED
`git: { commit, branch }` off its options, the framework bindings hand it
`{ versions, ...config }`, and nothing mapped the flat config keys onto the
nested one — so `opts.git` was `undefined` unless a host passed it itself, and
the only thing that worked was `VAL_GIT_COMMIT` / `VAL_GIT_BRANCH` in the
environment.

There are now three sources, most specific first: the host's own `git` option,
then `gitCommit` / `gitBranch` from `val.config.ts`, then the environment. That
is the precedence `val debug` already used for the same two values.

**What a commit is for**, and why its absence is worth a patch release rather
than a shrug: publishing turns pending patches into new `.val.ts` text, and to
patch a file you must first read it — at a commit. A project with none is a
project whose publishes read whatever the content service last had, rather than
the revision the deployed code was built from.

**One behaviour change to know about.** A commit and a branch have always been
taken together or not at all, and that check now sees config-supplied values
too. A project that sets exactly one of `gitCommit` and `gitBranch` used to have
both quietly ignored and will now be refused at startup, naming the missing
half. That is the same error an env var or a `git` option with one half has
always produced, and it is the configuration that would otherwise fail later, at
a publish.

Also fixes `initVal()` handing back `config: undefined` while `InitVal` declares
it `ValConfig`. It is `{}` now. Nothing had read a key off it before
`initHandlerOptions` came to read `gitCommit`, which is how a declared type
stayed untrue for that long.
