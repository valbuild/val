---
"@valbuild/server": patch
"@valbuild/tanstack": patch
---

Fix `gitCommit` and `gitBranch` in `val.config.ts` never reaching the server,
and make them the one way to say it.

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

The two halves never met. The server wanted a nested
`git: { commit, branch }`, `val.config.ts` offered two flat keys, and nothing
mapped one onto the other — so the only thing that worked was
`VAL_GIT_COMMIT` / `VAL_GIT_BRANCH` in the environment.

Rather than teach the server to read both, the nested option is gone:
`ValApiOptions` and TanStack's `ValHttpMode` now take `gitCommit` and
`gitBranch`, the same two names `ValConfig` uses. There is one name for this
now, wherever it is set. The framework bindings already hand the server
`{ versions, ...config }`, so a project's config keys arrive with nothing to
map, and a host passing them directly is saying the same thing in the same
words.

Flat because of where these values come from. A platform supplies them as
`process.env.VERCEL_GIT_COMMIT_SHA` and friends, typed `string | undefined`,
and two optional strings take that as it comes — a nested object makes every
caller write the ternary that turns two maybe-strings into one maybe-object.

**Breaking for a host that passed `git` itself**, which is the nested option on
`ValApiOptions` and on TanStack's `http` mode. An app that only configures
`val.config.ts` or the environment is unaffected.

```ts
// before
initValServer(valModules, config, {
  http: { apiKey, valSecret, git: { commit, branch } },
});

// after
initValServer(valModules, config, {
  http: { apiKey, valSecret, gitCommit: commit, gitBranch: branch },
});
```

**What a commit is for**, and why its absence is worth a release rather than a
shrug: publishing turns pending patches into new `.val.ts` text, and to patch a
file you must first read it — at a commit. A project with none is a project
whose publishes read whatever the content service last had, rather than the
revision the deployed code was built from.

**One more behaviour change.** A commit and a branch have always been taken
together or not at all, and that check now sees config-supplied values too. A
project that sets exactly one of `gitCommit` and `gitBranch` used to have both
quietly ignored and will now be refused at startup, naming the missing half.
That is the configuration that would otherwise fail later, at a publish.
