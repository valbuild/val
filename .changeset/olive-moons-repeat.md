---
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/tanstack": minor
"@valbuild/ui": minor
"@valbuild/cli": minor
---

http mode no longer needs a git repository

A Val app can now run in http mode with no commit and no branch — its content
service is the store of record, and git is an optional mirror of the code. This
is what `fs` mode has always done: it has never had git, and it works.

Before this, `VAL_API_KEY` and `VAL_SECRET` were not enough. `VAL_GIT_COMMIT`
and `VAL_GIT_BRANCH` were required too, so a deployment with no commit to name
either threw at boot or fell through to `fs` mode and reached for a working
tree that was not there.

**Breaking, if you pass `http` options in code.** `gitCommit` and `gitBranch`
are replaced by one optional `git`:

```diff
 initValServer(valModules, config, {
   http: {
     apiKey,
     valSecret,
-    gitCommit: process.env.VAL_GIT_COMMIT,
-    gitBranch: "main",
+    // Only for a project whose content is mirrored into a repository.
+    // Omit it entirely otherwise.
+    git: { commit: process.env.VAL_GIT_COMMIT, branch: "main" },
   },
 })
```

`VAL_GIT_COMMIT` and `VAL_GIT_BRANCH` still work and are still read; they are
simply no longer required. Set both or neither — a commit without a branch, or
a branch without a commit, is refused at startup with a message naming the
missing half, rather than failing later at a publish.

**What a commit is for, where you have one.** Turning pending patches into new
`.val.ts` text means reading the current text first, and that read goes to the
content service at that commit. It is the publish path, not the serving path: a
committed render reads the source compiled into the build and asks the content
service nothing. With no repository there is nothing to write `.val.ts` into,
so a publish records the module's data and its schema and skips the file — and
that data is what history reads, so nothing is lost.

**A publish can now be refused by name, before it is attempted.** If a project
mirrors its commits into a repository but the running deployment was built
before that repository existed, it has no commit to write the mirror against.
Publishing anyway would save the content and silently leave the repository
behind. The Studio now disables Publish and shows why, and `/save` refuses with
a `no-base` code instead of failing partway.

**Also:** `ValCommit` and `HistoricalCommit` have nullable `parentCommitSha`
and `clientCommitSha`, and `/stat`'s `commitSha` is optional. A root commit has
no parent, and a publisher with no repository does not report where it was. If
you read these fields, handle `null`.
