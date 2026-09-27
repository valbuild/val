---
"@valbuild/server": patch
---

Show history for projects whose git branch is resolved by the server

A proxy-mode project that mirrors into a repository is committing to some
branch, and every commit and history listing is filed under it. But the Studio
reads `gitBranch` from `val.config` alone, where it is optional — so a project
that named its branch the usual deployment way (in the environment, e.g. from
`VERCEL_GIT_COMMIT_REF`) got a History pane reading "this project has no
`gitBranch` configured" and a status bar with no branch on it, while the server
behind it was busy committing to one.

`/stat` now fills in the branch the server resolved when `val.config` does not
name one. A branch in `val.config` still wins.

Nothing changes where there is no branch to name, and that is a real case
rather than a gap: git is optional in proxy mode — a project can run on
credentials alone, with no repository to mirror into — and `fs` mode has no
commits of its own. Those projects are handed no branch, and the Studio hides
what needs one rather than offering a History page that can only apologise.
