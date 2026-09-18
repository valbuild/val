---
"@valbuild/server": patch
---

Show history for projects that name their git branch in the environment

In proxy mode the branch is required — `VAL_GIT_BRANCH` — and every commit and
history listing is filed under it. But the Studio reads `gitBranch` from
`val.config` alone, which is optional there, so a project that named its branch
the usual deployment way (in the environment, e.g. from
`VERCEL_GIT_COMMIT_REF`) got a History pane reading "this project has no
`gitBranch` configured" and a status bar with no branch on it — while the
server behind it was committing to one.

`/stat` now fills in the branch the server resolved when `val.config` does not
name one. A branch in `val.config` still wins, and `fs` mode is unchanged:
there are no commits there for a branch to list.
